import Logger from './logger.js'
import setCookie from 'set-cookie-parser'
import { CronJob } from 'cron';


module PadelBot {

    const TASK_EXEC_RESULT = {
        RETRY: 0,
        DONE: 1,
        ABORT: 2
    }

    function computeDateDiffInDays(requestedDate:string)
    {
        let localDateStr = new Date().toLocaleDateString();
        let localDateObj = new Date(localDateStr + " UTC");

        let localDay = localDateObj.getDate() + 30*(1+localDateObj.getMonth()) + 365*localDateObj.getFullYear();
        let requestedDay = parseInt(requestedDate.split("-")[2]) + 30*parseInt(requestedDate.split("-")[1]) + 365*parseInt(requestedDate.split("-")[0]);
        return requestedDay - localDay
    }

    function addLog(logs_arr:any, level:string, message:string)
    {
        logs_arr.push({
            name: `${new Date().toISOString().split('.')[0].split('T')[1]} - ${level.toUpperCase()}`,
            value: message
        })
    }
    export class PadelBot {
        public constructor(discordBot: any, configData:any) {
            this.discordBot = discordBot
            this.tasks = []
            this.allowedTimes = configData.allowedTimes

            this.clubs = {}
            this.clubsFullNames = {}
            let startUpAnnounceFields = [
                {
                    name: "Previous tasks lost",
                    value: "Make sure to recreate them if needed"
                }
            ]
            for (let clubName in configData.clubs)
            {
                Logger.info(`Loading club '${clubName}'`)
                let configClub = configData.clubs[clubName]
                if (configClub.apiType == "balleJaune")
                {
                    this.clubs[clubName] = new BalleJauneBooker(configClub)
                    this.clubsFullNames[clubName] = configClub.fullname
                }
                else if (configClub.apiType == "allin")
                {
                    this.clubs[clubName] = new DoinSportBooker(configClub)
                    this.clubsFullNames[clubName] = configClub.fullname
                    if (configClub.autoMonitor && configClub.autoMonitor.enabled)
                    {
                        this.autoMonitor(clubName, configClub.autoMonitor)
                        startUpAnnounceFields.push({
                            name: "Auto-monitoring started",
                            value: `Running for ${this.getClubFullName(clubName)}`
                        })
                    }
                }
                else
                {
                    Logger.error(`Unknown api type for club ${this.getClubFullName(clubName)}: ${configClub.apiType}`)
                }
            }

            this.runTaskDeamon()

            Logger.info("Padel Bot started")
            this.notifyWithFields("Padel Bot started", "Announces", "#800080", startUpAnnounceFields)
            for (let clubName in this.clubs)
            {
                this.listBookingsForClub(clubName)
            }
        }
        
        private autoMonitor(clubName: string, autoMonitor: any) {
            let clubsFullName = this.getClubFullName(clubName);
            Logger.info(`Starting auto-monitor for ${clubsFullName}`)
            let padelBot = this;
            new CronJob(
                autoMonitor.runCrontime,
                async function () {
                    Logger.info(`Running auto-monitor for ${clubsFullName}`)
                    let availableSlots = []
                    for (let dayOffset of autoMonitor.daysOffset)
                    {
                        let newAvail = await padelBot.getAvailableSlots(clubName, autoMonitor, dayOffset);
                        availableSlots.push(...newAvail)
                    }
                    if (availableSlots.length == 0)
                    {
                        Logger.info(`No interesting slots found for ${clubsFullName} at ${autoMonitor.targetTime}`)
                        return
                    }
                    Logger.info(`Available slots found for ${clubsFullName}`, availableSlots)
                    padelBot.notifyWithFields("Auto Monitoring "+clubsFullName, "Available slots found that might interests you. Make sure you request for booking in case you want to proceed", "#00ff00", availableSlots);
                },
                null,
                true,
                'Europe/Paris'
            );
        }

        private async getAvailableSlots(clubName: string, autoMonitor: any, dayOffset: any) {
            let clubsFullName = this.getClubFullName(clubName);
            let clubBookingObject = this.clubs[clubName];

            let targetDate = new Date()
            targetDate.setDate(targetDate.getDate() + dayOffset)
            let targetDateStr = targetDate.toISOString().split('.')[0].split('T')[0]
            let availableSlots = await clubBookingObject.listAvailableSlots(
                targetDateStr,
                autoMonitor.targetTime,
                this.getNextTime(autoMonitor.targetTime)
            );
            if (availableSlots == null)
            {
                Logger.error(`Auto-monitor for ${clubsFullName} failed`)
                this.notifyWithFields("Auto Monitoring "+clubsFullName, "Unexpected failure", "#ff0000", clubBookingObject.getLogs())
                return []
            }
            return availableSlots;
        }

        public handleAction(type:string, data: string) {
            if (type == "message")
            {
                try
                {
                    if (data == "!tasklist")
                    {
                        this.displayTasksList()
                    }
                    if (data.indexOf("!task ") == 0)
                    {
                        this.newTask(data.replace("!task ", ""))
                    }
                    if (data.indexOf("!rmtask ") == 0)
                    {
                        let taskIndex = parseInt(data.replace("!rmtask ", ""))
                        if (isNaN(taskIndex))
                        {
                            this.discordBot.sendMessage("Invalid task index", {color:"#ff0000"})
                            return
                        }
                        if (taskIndex < 0 || taskIndex >= this.tasks.length)
                        {
                            this.discordBot.sendMessage("Task index out of range", {color:"#ff0000"})
                            return
                        }
                        this.tasks.splice(taskIndex, 1)
                        this.displayTasksList("Task removed successfully", "#00ff00")
                    }
                    if (data.indexOf("!help") == 0)
                    {
                        this.discordBot.sendMessage(`Sample of possible instructions`, {
                            title: "Help",
                            fields: [
                                {
                                    name: "!task book <club-name> 25MAR 18:30",
                                    value: "Book at 18h00 on 25th of March. Available clubs: "+Object.keys(this.clubs).join(', ')
                                },
                                {
                                    name: "!task list-bookings <club-name>",
                                    value: "List bookings done club-name."
                                },
                                // {
                                //     name: "!task monitor <club-name> 18:30",
                                //     value: "Monitor for last minute available slot at 18h30."
                                // },
                                {
                                    name: "!rmtask i",
                                    value: "Remove task with index i"
                                },
                                {
                                    name: "!tasklist",
                                    value: "List all tasks"
                                }
                            ]
                        })
                    }
                }
                catch (e)
                {
                    this.discordBot.sendMessage("Error while analysing message"+e, {color:"#ff0000"})
                    Logger.error(e)
                }  
            }
        }

        private getCleanedTime(time:string)
        {
            if (!this.allowedTimes.includes(time))
            {
                this.discordBot.sendMessage("Wrong time format. Allowed values: " + this.allowedTimes.join(', ') , {color:"#ff0000"})
                return null
            }
            return time
        }

        private getNextTime(time:string)
        {
            let timeIndex = this.allowedTimes.indexOf(time)
            if (timeIndex == -1)
            {
                this.discordBot.sendMessage("Wrong time format. Allowed values: " + this.allowedTimes.join(', ') , {color:"#ff0000"})
                return null
            }
            if (timeIndex+1 >= this.allowedTimes.length)
            {
                this.discordBot.sendMessage("No end time defined for "+time, {color:"#ff0000"})
                return null
            }
            return this.allowedTimes[timeIndex+1]
        }

        private getCleanedDate(rawDate:string)
        {
            let dateStr = null;
            if (rawDate.length == 5)
            {
                dateStr = rawDate+""+(new Date().getFullYear());
            }
            else if (rawDate.length == 9)
            {
                dateStr = rawDate;
            }
            else
            {
                this.discordBot.sendMessage(`Wrong date format. You must provide date with format 25MAR or 12JAN2024, found '${rawDate}'`, {color:"#ff0000"})
                return null
            }
            let date = new Date(dateStr + " UTC")
            if (isNaN(date.getTime()))
            {
                this.discordBot.sendMessage("Incorrect date. You must provide date with format 25MAR or 12JAN2024", {color:"#ff0000"})
                return null
            }

            // Convert date to 2021-01-17
            let month = date.getMonth()+1
            let day = date.getDate()
            let year = date.getFullYear()
            let monthStr = month < 10 ? "0"+month : month
            let dayStr = day < 10 ? "0"+day : day
            return `${year}-${monthStr}-${dayStr}`
        }

        private newTask(taskData:string)
        {
            // Parse task data
            let taskDataSplit = taskData.split(" ")
            let taskType = taskDataSplit[0]
            if (taskType == "book")
            {
                if (taskDataSplit.length != 4)
                {
                    this.discordBot.sendMessage(`Wrong task format. Expecting 4 arguments, got ${taskDataSplit.length}`, {color:"#ff0000"})
                    return
                }

                let clubName = taskDataSplit[1];
                if (!this.clubs[clubName])
                {
                    this.discordBot.sendMessage(`Unknown club ${clubName}`, {color:"#ff0000"})
                    return
                }
                
                // Format date to 2021-01-17
                let date = this.getCleanedDate(taskDataSplit[2])
                if (date == null)
                {
                    return
                }
                let time = this.getCleanedTime(taskDataSplit[3])
                if (time == null)
                {
                    return
                }

                this.tasks.push(
                    {
                        type: "book",
                        club: clubName,
                        date: date,
                        time: time,
                        duration: 90,
                        tries: 0,
                        status: "pending"
                    }
                )
                this.displayTasksList(`Task booking '${this.getClubFullName(clubName)}' created`, "#00ff00")
            }
            else if (taskType == "list-bookings")
            {
                if (taskDataSplit.length != 2)
                {
                    this.discordBot.sendMessage(`Wrong format. Expecting 1 arguments, got ${taskDataSplit.length}`, {color:"#ff0000"})
                    return
                }
                let clubName = taskDataSplit[1];
                if (!this.clubs[clubName])
                {
                    this.discordBot.sendMessage(`Unknown club ${clubName}`, {color:"#ff0000"})
                    return
                }
                this.listBookingsForClub(clubName)
            }
            else if (taskType == "monitor")
            {
                this.discordBot.sendMessage("Not yet implemented", {color:"#ff0000"})
            }
            else
            {
                this.discordBot.sendMessage("Unknown task type", {color:"#ff0000"})
            }
        }

        private async listBookingsForClub(clubName: string) {
            let clubBookingObject = this.clubs[clubName];
            let bookings = await clubBookingObject.listBookings()
            if (bookings == null)
            {
                this.notifyWithFields("Existing bookings at "+this.getClubFullName(clubName), "Unable to list bookings", "#ff0000", clubBookingObject.getLogs())
                return
            }
            let fields = []
            for (let booking of bookings)
            {
                fields.push({
                    name: booking.title,
                    value: booking.description
                })
            }
            this.notifyWithFields("Existing booking at "+this.getClubFullName(clubName), `${bookings.length} bookings found`, "#00ff00", fields)
        }

        private getClubFullName(clubName: string)
        {
            let fullname = this.clubsFullNames[clubName]
            if (!fullname)
            {
                return clubName
            }
            return fullname
        }

        private taskToString(task:any)
        {
            let text = "Uknown task type"
            if (task.type == "book")
            {
                text = `At ${this.getClubFullName(task.club)} on ${task.date} from ${task.time} to ${this.getNextTime(task.time)}`
            }
            if (task.status == "done")
            {
                text += ` | Completed: ${task.result}`
            }
            else
            {
                text += ` | Status: ${task.status}`
            }
            return text
        }

        private notifyWithFields(title:string, message:string, color:string = null, fields:any = null)
        {
            this.discordBot.sendMessage(message, {
                title: title,
                fields: fields,
                color: color
            })
        }

        private notifyTaskMessage(task:any, message:string, color:string = null, title:string = null, fields:any = null)
        {
            this.notifyWithFields(
                title ? title : "Task updated",
                message,
                color,
                [
                    {
                        name: "Task " + task.type,
                        value: this.taskToString(task)
                    }
                ]
            )
        }

        private notifyExecLogs(task:any, logsArray:any)
        {
            let fields = []
            let color = '#909090'
            let highestLevel = 0
            let status = "INFO"
            if (task)
            {
                fields.push({
                    name: "Task " + task.type,
                    value: this.taskToString(task)
                })
            }
            for (let log of logsArray)
            {
                if (highestLevel < 4 && log.name.indexOf("ERROR") != -1)
                {
                    color = "#ff0000"
                    highestLevel = 4
                    status = "Error"
                }
                else if (highestLevel < 3 && log.name.indexOf("OK") != -1)
                {
                    color = '#00ff00'
                    highestLevel = 3
                    status = "OK"
                }
                else if (highestLevel < 2 && log.name.indexOf("NOTIFY") != -1)
                {
                    color = '#0099ff'
                    highestLevel = 2
                    status = "Notify"
                }
                fields.push({
                    name: log.name,
                    value: log.value
                })
            }
            this.notifyWithFields(
                "Execution logs",
                `Global status: ${status}`,
                color,
                fields
            )
        }

        private displayTasksList(title:string = "Task list", color:string = null)
        {
            let fields = []
            for (let i = this.tasks.length-1; i>=0; i--)
            {
                let aTask = this.tasks[i]
                fields.push({
                    name: `Task ${i}: ${aTask.type} ${this.getClubFullName(aTask.club)}`,
                    value: this.taskToString(aTask)
                })
            }
            this.discordBot.sendMessage(`${this.tasks.length} on-going tasks`, {
                title: title,
                fields: fields,
                color: color
            })
        }

        private getDaysBeforeBookForTask(task:any)
        {
            return this.clubs[task.club].getDaysBeforeBooking();
        }

        private async runBookPadelTask(iTask:any)
        {
            if (iTask.status == "pending")
            {
                // Ckeck if we can start trying to book (reservation is opened 7 days before)
                
                let daysDiff = computeDateDiffInDays(iTask.date)
                // Logger.debug(`Local day: ${localDay}, Requested day: ${requestedDay}, Diff: ${daysDiff}`)
                if (daysDiff < 0)
                {
                    iTask.status = "abandonned"
                    this.notifyTaskMessage(iTask, `Abandonned as requested slot is in the past`, "#ff0000")
                }
                else if (daysDiff <= this.getDaysBeforeBookForTask(iTask))
                {
                    iTask.status = "trying"
                    this.notifyTaskMessage(iTask, `Reservation should be opened, starting to try to book`)
                }
            }
            if (iTask.status == "trying")
            {
                if (iTask.tries >= 5)
                {
                    iTask.status = "abandonned"
                    this.notifyTaskMessage(iTask, `Abandonned after ${iTask.tries} tries`, "#ff0000")
                    return
                }
                
                iTask.tries++
                if (iTask.type == "book")
                {
                    Logger.debug(`Trying to book on ${iTask.date} at ${iTask.time}`)
                    let clubBookingObject = this.clubs[iTask.club];
                    let isBooked = await clubBookingObject.tryBooking(iTask.date, iTask.time, this.getNextTime(iTask.time))
                    this.notifyExecLogs(iTask, clubBookingObject.getLogs())
                    if (isBooked == TASK_EXEC_RESULT.DONE)
                    {
                        iTask.status = "done"
                        iTask.result = "Booked successfully"
                        this.notifyTaskMessage(iTask, `Booked successfully at '${iTask.club}' after ${iTask.tries} tries`, "#00ff00")
                    }
                    else if (isBooked == TASK_EXEC_RESULT.ABORT)
                    {
                        iTask.status = "abandonned"
                        this.notifyTaskMessage(iTask, `Abandonned after ${iTask.tries} tries`, "#ff0000")
                    }
                }
                else
                {
                    Logger.error("Unknown task type", iTask.api)
                    iTask.status = "abandonned"
                    this.notifyTaskMessage(iTask, `Unknown api ${iTask.api}`, "#ff0000")
                }
            }
        }

        private async runTaskDeamon()
        {
            try
            {
                // Logger.debug(`Checking ${thisObj.tasks.length} tasks`)
                for (let i in this.tasks)
                {
                    let aTask = this.tasks[i]
                    if (aTask.type == "book")
                    {
                        await this.runBookPadelTask(aTask)
                    }
                }
            }
            catch (e)
            {
                Logger.error("runTaskDeamon exception:", e);
            }
            setTimeout(() => this.runTaskDeamon(), 3000)
        }

        discordBot:any;
        tasks:any;
        clubs:any;
        clubsFullNames:any;
        allowedTimes:any;
    }

    class BalleJauneBooker {
        public constructor(config:any) {
            this.apiUrl = config.apiUrl
            this.schedules = config.schedules
            this.credentials = config.credentials
            this.daysBeforeBooking = config.daysBeforeBooking
            this.clubId = config.clubId
            this.duration = 90
            this.executionLogs = []
            this.currentCookies = {}
        }

        public getDaysBeforeBooking()
        {
            return this.daysBeforeBooking;
        }

        public getLogs()
        {
            return this.executionLogs
        }

        private addLog(level:string, message:string)
        {
            addLog(this.executionLogs, level, message)
        }

        public async listBookings()
        {
            this.executionLogs = []
            this.addLog("error", "Not yet implemented for BalleJaune API")
        }

        public async listAvailableSlots(date, time, endTime)
        {
            this.executionLogs = []
            this.addLog("error", "Not yet implemented for BalleJaune API")
        }

        public async tryBooking(date, time, endTime)
        {
            this.executionLogs = []
            try {
                this.endTime = endTime
                for (let credential of Object.keys(this.credentials))
                {
                    this.addLog("info", `Trying to book with '${credential}' credentials`)
                    Logger.debug(`Trying to book with '${credential}' credentials`)
                    let isBooked = await this.tryBookingWithCred(this.clubId, this.credentials[credential], date, time)
                    if (isBooked)
                    {
                        this.addLog("notify", "Booked successfully with '"+credential+"' account")
                        return TASK_EXEC_RESULT.DONE;
                    }
                }
            }
            catch (e)
            {
                Logger.error("Unknown exception while trying to book", e);
                this.addLog("error", "Unknown exception while trying to book: "+e)
                return TASK_EXEC_RESULT.ABORT;
            }
            return TASK_EXEC_RESULT.RETRY;
        }


        private async callBookingApi(url = '', body = "", method = 'POST', getCookies = false, referrer = "") 
        {
            if (referrer != "")
            {
                this.referrer = this.apiUrl+referrer;
            }
            // body = encodeURI(body);
            // Logger.debug("Calling", this.apiUrl+url, method, body, this.currentCookies);
            await this.sleep(500);
            let response = await fetch(this.apiUrl+url, {
                "headers": {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "sec-ch-ua": "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "x-requested-with": "XMLHttpRequest",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "cookie": Object.keys(this.currentCookies).map((key) => key + "=" + this.currentCookies[key]).join("; "),
                "Referer": this.referrer,
                "Referrer-Policy": "no-referrer-when-downgrade"
                },
                "body": body,
                "method": method
            });
            this.referrer = url;

            if (response.status != 200)
            {
                return {
                    status: response.status,
                    error: response.statusText
                }
            }
            if (getCookies)
            {
                var splitCookieHeaders = setCookie.splitCookiesString(response.headers.get("set-cookie"))
                var cookies_list = setCookie.parse(splitCookieHeaders);
                for (let cookie of cookies_list)
                {
                    this.currentCookies[cookie.name] = cookie.value;
                }
            }
            let rawData:any = await response.text();
            let isJson = false
            try {
                rawData = JSON.parse(rawData);
                isJson = true;
            }
            catch (e) {
                // Not json
            }
            return {
                status: response.status,
                isJson: isJson,
                data: rawData
            }
        }

        private getCsrfToken(reply)
        {
            let handlers = reply.data?.handlers
            let args = handlers ? handlers[0]?.args : null
            let new_csrf_auth_login = args ? args[1] : null
            return new_csrf_auth_login;
        }

        private async login(clubid, user, password, csrf_auth_login = "", canRetry = true)
        {
            let reply = await this.callBookingApi(
                "/auth/login/from/club-home", 
                `username=${user}&password=${password}&cookie_enabled=true&club_id=${clubid}&csrf_auth_login${clubid}=${csrf_auth_login}&remember=1`,
                "POST",
                true)
            if (reply.status != 200)
            {
                this.addLog("error", "Error logging in" + reply.error);
                Logger.error("Error logging in", reply.error);
                return false;
            }
            if (reply.isJson && csrf_auth_login == "")
            {
                let new_csrf_auth_login = this.getCsrfToken(reply)
                if (new_csrf_auth_login)
                {
                    Logger.debug("Logging in with csrf_auth_login", new_csrf_auth_login);
                    return this.login(clubid, user, password, new_csrf_auth_login, true);
                }
                else
                {
                    Logger.warning("Error logging in, unable to find csrf_auth_login in", reply.data);
                    return false;
                }
            }
            else if (reply.isJson && reply.data.success)
            {
                Logger.ok("Logged in successfully !!!");
                this.addLog("ok", "Logged in successfully !!!");
                return true;
            }
            else
            {
                if (canRetry)
                {
                    let new_csrf_auth_login = this.getCsrfToken(reply)
                    if (new_csrf_auth_login)
                    {
                        return this.login(clubid, user, password, new_csrf_auth_login, false);
                    }
                }
                this.addLog("error", "Error logging in: "+reply.data);
                Logger.error("Error logging in: ", reply.data);
                return false;
            }
        }


        private async getTokenForSchedule(dateDiffInDays, time, schedule, loginUsed)
        {
            Logger.debug(`Checking availabilty for schedule ${schedule} with date ${dateDiffInDays} at ${time}`)
            let reply = await this.callBookingApi(
                "/reservation/switch",
                `date=${dateDiffInDays}&schedule=${schedule}&timestart=${time}&duration=${this.duration}`,
                "POST",
                false,
                "/reservation"
            )
            if (reply.status != 200)
            {
                Logger.warning(`Error getting availabilty for schedule ${schedule}`, reply.error);
                this.addLog("error", `Error getting availabilty for schedule ${schedule}`+ reply.error);
                return null;
            }
            if (!reply.isJson)
            {
                let csrf_reservation = reply.data.split("csrf_reservation\" value=\"")[1].split("\"")[0];
                return csrf_reservation
            }
            else
            {
                if (reply.data?.alert?.title == "Quota de réservation")
                {
                    this.addLog("notify", `'${loginUsed}' is not able to book slot, quota reached for this account`);
                    Logger.info(`'${loginUsed}' is not able to book slot, quota reached for this account`);
                    return null;
                }
                else
                {
                    this.addLog("error", "Unable to get CSRF" +reply.data);
                    Logger.warning("Unable to get CSRF", reply.data);
                    return null;
                }
            }
        }

        private async reserve(date, time, schedule, csrf_reservation)
        {
            let reply = await this.callBookingApi(
                "/reservation/process",
                `action_type=create&choice=with_none&default_date=${date}&default_timestart=${time}&default_timeend=${this.endTime}&default_duration=${this.duration}&default_schedule=${schedule}&default_row=0&poll_request_id=0&csrf_reservation=${csrf_reservation}`
            )
            
            if (reply.status == 200 && reply.isJson && reply.data.success)
            {
                Logger.ok("Booked successfully !!!");
                this.addLog("ok", "Booked successfully !!!");
                return true;
            }
            else if (reply.status == 200 && reply.isJson && reply.data.alert?.title)
            {
                Logger.ok("Not possible to book slot:", reply.data.alert.title);
                this.addLog("error", `Not possible to book slot: ${reply.data.alert.title}`);
                return false;
            }
            else
            {
                this.addLog("error", "Unable to book slot" + reply.status + " " + reply.error + " " + reply.data);
                Logger.error("Unable to book slot", reply.status, reply.error, reply.data);
                return false;
            }
        }

        private async tryBookingWithCred(clubid, credential, date, time)
        {
            let isLoggedIn = await this.login(clubid, credential.login, credential.password);
            if (!isLoggedIn)
            {
                Logger.warning("Unable to login");
                return;
            }
            let timeInMinutes = parseInt(time.split(":")[0]) * 60 + parseInt(time.split(":")[1]);
            
            for (let schedule of this.schedules)
            {
                let dateDiffInDays = computeDateDiffInDays(date)
                let csrf_reservation = await this.getTokenForSchedule(dateDiffInDays, timeInMinutes, schedule.value, credential.login);
                if (csrf_reservation != null)
                {
                    Logger.info(`Trying to book ${date} ${time} on schedule ${schedule.name} with token : ${csrf_reservation}`);
                    let isBooked = await this.reserve(date, time, schedule.value, csrf_reservation);
                    if (isBooked)
                    {
                        return true;
                    }
                }
            }
        }


        private async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }


        currentCookies:any;
        referrer:string;
        endTime:any;
        
        // Config
        duration:any;
        schedules:any;
        credentials:any;
        clubId:any;
        apiUrl:string;
        daysBeforeBooking:any;
        executionLogs:any;
    }

    class DoinSportBooker {
        public constructor(config:any) {
            this.apiUrl = config.apiUrl
            this.accountName = config.accountName
            this.accountId = config.accountId
            this.user = config.user
            this.password = config.password
            this.clubId = config.clubId
            this.clubWhiteLabel = config.clubWhiteLabel
            this.activityId = config.activityId
            this.daysBeforeBooking = config.daysBeforeBooking
            this.executionLogs = []
        }

        public getLogs()
        {
            return this.executionLogs
        }

        public getDaysBeforeBooking()
        {
            return this.daysBeforeBooking;
        }

        private addLog(level:string, message:string)
        {
            addLog(this.executionLogs, level, message)
        }

        public async listBookings()
        {
            try {
                this.executionLogs = []
                let bearerToken = await this.login();
                if (bearerToken == null)
                {
                    return null;
                }
                return await this.getBookings(bearerToken);
            }
            catch (e)
            {
                Logger.error("Exception while listing bookings", e);
                this.addLog("error", "Exception while listing bookings: "+e);
                return null;
            }
        }

        public async listAvailableSlots(date, time, endTime)
        {
            this.executionLogs = []
            try {
                let bearerToken = await this.login();
                if (bearerToken == null)
                {
                    return null;
                }
                let {availableSlots, alreadyBookedFound} = await this.getAvailableSlots(date, time, endTime, bearerToken);
                if (availableSlots == null || availableSlots.length == 0)
                {
                    if (alreadyBookedFound)
                    {
                        this.addLog("notify", "Everything is booked, no need to try again");
                        return [];
                    }
                    else
                    {
                        this.addLog("error", "No available slots found, but no booked slot found. This is unexpected");
                        return null;
                    }
                }
                let availableSlotsFileds = []
                for (let slot of availableSlots)
                {
                    availableSlotsFileds.push({
                        name: slot["day"] + " at " + slot["playground"],
                        value: `From ${slot["startAt"]} to ${slot["endAt"]}`
                    })
                }
                return availableSlotsFileds;
            }
            catch (e)
            {
                Logger.error("Exception while listing available slots", e);
                this.addLog("error", "Exception while listing available slots: "+e);
                return null;
            }
        }

        public async tryBooking(date, time, endTime)
        {
            this.executionLogs = []
            try {
                let bearerToken = await this.login();
                if (bearerToken == null)
                {
                    return TASK_EXEC_RESULT.RETRY;
                }
                let {availableSlots, alreadyBookedFound} = await this.getAvailableSlots(date, time, endTime, bearerToken);
                if (availableSlots == null || availableSlots.length == 0)
                {
                    if (alreadyBookedFound)
                    {
                        this.addLog("notify", "Everything is booked, no need to try again");
                        return TASK_EXEC_RESULT.ABORT;
                    }
                    else
                    {
                        return TASK_EXEC_RESULT.RETRY;
                    }
                }
                let bestSlot = this.selectBestSlot(availableSlots);
                if (bestSlot == null)
                {
                    return TASK_EXEC_RESULT.ABORT;
                }
                let clubBooking = await this.getClubBooking(bestSlot, bearerToken);
                if (clubBooking == null)
                {
                    return TASK_EXEC_RESULT.ABORT;
                }
                if (await this.confirmBooking(clubBooking, bearerToken))
                {
                    return TASK_EXEC_RESULT.DONE;
                }
                else
                {
                    return TASK_EXEC_RESULT.ABORT;
                }
            }
            catch (e)
            {
                Logger.error("Exception while trying to book", e);
                this.addLog("error", "Exception while trying to book: "+e);
                return TASK_EXEC_RESULT.ABORT;
            }
        }

        private async getBookings(bearerToken: any) {
            let url = `/clubs/bookings?activityType[]=sport&activityType[]=lesson&activityType[]=event&activityType[]=leisure&activityType[]=formula`
            url += `&canceled=false&startAt[after]=${new Date().toISOString().split('.')[0]}&order[startAt]=ASC`
            url += `&club.id[]=${this.clubId}&participants.user.id=${this.accountId}&itemsPerPage=10&page=1&confirmed=true`
            let reply = await this.callApi(url, null, "GET", bearerToken);
            if (reply.status != 200 || reply?.isJson == false)
            {
                this.addLog("error", "Error while retrieving bookings: "+reply.error);
                Logger.error("Error while retrieving bookings", reply.error);
                return null;
            }
            else
            {
                let bookingsOk = []
                try {
                    let bookings = reply.data["hydra:member"]
                    for (let booking of bookings)
                    {
                        let startAt = booking["startAt"]
                        let endAt = booking["endAt"]
                        let playgroundName = booking["playgrounds"][0]["name"]
                        bookingsOk.push({
                            title: startAt.split('T')[0] + " on " + playgroundName,
                            description: `From ${startAt.split('T')[1].split('+')[0]} to ${endAt.split('T')[1].split('+')[0]}`
                        })
                    }
                }
                catch (e)
                {
                    Logger.error("Error while parsing bookings", e);
                    this.addLog("error", "Error while parsing bookings: "+e);
                    return null;
                }
                
                return bookingsOk
            }
        }

        
        
        private async confirmBooking(clubBooking: any, bearerToken: any) {
            try {
                clubBooking.confirmed = true
                clubBooking.club = "/clubs/"+this.clubId
                clubBooking.activity = '/activities/'+this.activityId
                clubBooking.playgrounds = [clubBooking.playgrounds[0]['@id']]
                clubBooking.participants = [clubBooking.participants[0]['@id']]
                clubBooking.timetableBlockPrice = clubBooking.timetableBlockPrice['@id']
                clubBooking.userClient = clubBooking.userClient['@id']
            }
            catch (e)
            {
                Logger.error("Error while adapting ClubBooking object", e);
                this.addLog("error", "Error while adapting ClubBooking object: "+e);
            }

            this.addLog("info", "Confirming booking ...");
            let reply = await this.callApi(`/clubs/bookings/${clubBooking.id}`, clubBooking, "PUT", bearerToken);
            if (reply.status != 200 || reply?.isJson == false)
            {
                this.addLog("error", "Error confirming booking: "+reply.error);
                Logger.error("Error confirming booking", reply.error);
                return false;
            }
            else
            {
                if (reply.data.confirmed)
                {
                    this.addLog("ok", "Confirmed properly");
                    return true
                }
                else
                {
                    this.addLog("error", "Server replied booking without confirmed state. Abort");
                    Logger.error("Error confirming booking", reply.data);
                    return false
                }
            }
        }
        
        private async getClubBooking(bestSlot: any, bearerToken: any) {
            this.addLog("info", `Preparing booking request for slot at ${bestSlot["playground"]} from ${bestSlot["startAt"]} to ${bestSlot["endAt"]} on ${bestSlot["day"]}`);
            let reply = await this.callApi('/clubs/bookings', {
                "timetableBlockPrice": "/clubs/playgrounds/timetables/blocks/prices/"+bestSlot["priceId"],
                "activity": "/activities/"+this.activityId,
                "canceled": false,
                "club": "/clubs/"+this.clubId,
                "startAt": `${bestSlot["day"]} ${bestSlot["startAt"]}`,
                "payments": [],
                "endAt": `${bestSlot["day"]} ${bestSlot["endAt"]}`,
                "name": this.accountName,
                "playgroundOptions": [],
                "playgrounds": [
                  "/clubs/playgrounds/"+bestSlot["playgroundId"]
                ],
                "maxParticipantsCountLimit": 4,
                "userClient": "/user-clients/"+this.accountId,
                "participants": [
                  {
                    "user": "/user-clients/"+this.accountId,
                    "restToPay": 450,
                    "bookingOwner": true
                  }
                ],
                "pricePerParticipant": 450,
                "paymentMethod": "on_the_spot",
                "creationOrigin": "white_label_app"
              }, "POST", bearerToken);
            if (reply.status != 201 || reply?.isJson == false)
            {
                this.addLog("error", "Error creating ClubBooking: "+reply.error);
                Logger.error("Error ClubBooking", reply.error);
                return null;
            }
            else
            {
                return reply.data
            }
        }

        private selectBestSlot(availableSlots: any[]) {
            let bestSlot = null
            let bestSlotIdx = -1
            let playgroundOrder = ['PADEL PISTE 2', 'PADEL PISTE 1', 'PADEL PISTE 4 "Cupra"', 'PADEL PISTE 3']
            for (let slot of availableSlots)
            {
                let playground = slot["playground"]
                let playgroundIdx = playgroundOrder.indexOf(playground)
                if (playgroundIdx == -1)
                {
                    continue
                }
                if (bestSlot == null || playgroundIdx < bestSlotIdx)
                {
                    bestSlot = slot
                    bestSlotIdx = playgroundIdx
                }
            }
            if (bestSlot == null)
            {
                this.addLog("error", "No best slot decided among:" + availableSlots);
                return null
            }
            this.addLog("ok", `Best slot is: ${bestSlot["playground"]} at ${bestSlot["startAt"]}`);
            return bestSlot
        }

        private async getAvailableSlots(date: any, time: any, endTime: any, bearerToken: any)
        {
            let alreadyBookedFound = false;
            let url = `/clubs/playgrounds/plannings/${date}`
            url += `?club.id=${this.clubId}`
            url += `&from=${time}:00`
            url += `&to=22:29:00`
            url += `&activities.id=${this.activityId}`
            url += `&bookingType=unique`
            let reply = await this.callApi(url, null, "GET", bearerToken);
            if (reply.status != 200 || reply?.isJson == false)
            {
                this.addLog("error", "Error while retrieving availabilities: "+reply.error);
                Logger.error("Error while retrieving availabilities", reply.error);
                return null;
            }
            else
            {
                let availableSlots = []
                try {
                    let playgrounds = reply.data["hydra:member"]
                    for (let playground of playgrounds)
                    {
                        let playGroundId = playground["id"]
                        let name = playground["name"]
                        let activities = playground["activities"]
                        for (let activity of activities)
                        {
                            if (activity["id"] != this.activityId)
                            {
                                continue
                            }
                            let slots = activity["slots"]
                            for (let slot of slots)
                            {
                                let startAt = slot["startAt"]
                                if (startAt != time)
                                {
                                    continue
                                }
                                let prices = slot["prices"]
                                for (let price of prices)
                                {
                                    let id = price["id"]
                                    let bookable = price["bookable"]
                                    let duration = price["duration"]
                                    if (duration !== 5400) // 90mins
                                    {
                                        continue
                                    }
                                    if (!bookable)
                                    {
                                        alreadyBookedFound = true
                                    }
                                    else
                                    {
                                        this.addLog("notify", `Playground '${name}' is available at ${time}`);
                                        availableSlots.push({
                                            playgroundId: playGroundId,
                                            playground: name,
                                            day: date,
                                            startAt: startAt+':00',
                                            duration: duration,
                                            endAt: endTime+':00',
                                            priceId: id
                                        })
                                    }
                                }
                            }
                        }
                    }
                }
                catch (e)
                {
                    Logger.error("Error while parsing available slots", e);
                    this.addLog("error", "Error while parsing available slots: "+e);
                                        
                    return null;
                }
                this.addLog("notify", `Found ${availableSlots.length} available slots`);
                // Logger.debug("Available slots", availableSlots);
                return {availableSlots, alreadyBookedFound}
            }
        }

        private async login()
        {
            let reply = await this.callApi('/client_login_check', {
                username: this.user,
                password: this.password,
                club: "/clubs/"+this.clubId,
                clubWhiteLabel: "/clubs/white-labels/"+this.clubWhiteLabel,
                origin: "white_label_app"
            }, "POST");
            if (reply.status != 200 || reply?.isJson == false)
            {
                this.addLog("error", "Error logging in: "+reply.error);
                Logger.error("Error logging in", reply.error);
                return null;
            }
            else
            {
                this.addLog("ok", "Logged in successfully as " + this.user);
                return reply.data.token
            }
        }

        private async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        private async callApi(url = '', body = {}, method = 'POST', bearerToken = "") 
        {
            await this.sleep(500);
            // Logger.debug("Calling", this.apiUrl+url, method, body, bearerToken);
            let response = await fetch(this.apiUrl+url, {
                "headers": {
                    "accept": "*/*",
                    "accept-language": "en-US,en;q=0.9",
                    "content-type": "application/json; charset=UTF-8",
                    "sec-ch-ua": "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"macOS\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "x-requested-with": "XMLHttpRequest",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Authorization": bearerToken == "" ? null : "Bearer "+bearerToken
                },
                "body": body == null ? null : JSON.stringify(body),
                "method": method
            });
            

            let rawData:any = await response.text();
            if (response.status != 200 && response.status != 201)
            {
                return {
                    status: response.status,
                    error: response.statusText + " - " + rawData,
                    isJson: false
                }
            }
            let isJson = false
            try {
                rawData = JSON.parse(rawData);
                isJson = true;
            }
            catch (e) {
                // Not json
            }
            return {
                status: response.status,
                isJson: isJson,
                data: rawData
            }
        }

        apiUrl:any;
        accountId:any;
        accountName:any;
        user:any;
        password:any;
        clubId:any;
        clubWhiteLabel:any;
        daysBeforeBooking:any;
        activityId:any;
        executionLogs:any;
    }
}

export default PadelBot
