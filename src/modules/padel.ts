import Logger from './logger.js'
import setCookie from 'set-cookie-parser'


module PadelBot {
    export class PadelBot {
        public constructor(discordBot: any, configData:any) {
            this.discordBot = discordBot
            this.tasks = []
            this.currentCookies = {}
            this.referrer = ""
            this.schedules = configData.schedules
            this.credentials = configData.credentials
            this.allowedTimes = configData.allowedTimes
            this.duration = configData.duration
            this.daysBeforeBooking = configData.daysBeforeBooking
            this.clubs = configData.clubs
            this.baseUrl = configData.baseUrl

            this.startTaskDeamon()

            Logger.info("Padel Bot started")
            this.discordBot.sendMessage("Padel Bot just re-started, no task pending", {color:"#800080"})
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
                                    name: "!task book polygone 25MAR 18:30",
                                    value: "Book a padel at 18h00 on 25th of March at Polygone"
                                },
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

                let club = taskDataSplit[1]
                if (!this.clubs[club])
                {
                    this.discordBot.sendMessage("Wrong club name. Allowed values: " + Object.keys(this.clubs).join(', ') , {color:"#ff0000"})
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
                        type: "book-padel",
                        club: club,
                        date: date,
                        time: time,
                        tries: 0,
                        status: "pending"
                    }
                )
                this.displayTasksList("Task added successfully", "#00ff00")
            }
            else
            {
                this.discordBot.sendMessage("Unknown task type", {color:"#ff0000"})
            }
        }

        private async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        private taskToString(task:any)
        {
            let text = "Uknown task type"
            if (task.type == "book-padel")
            {
                text = `At ${task.club} on ${task.date} from ${task.time} to ${this.getNextTime(task.time)}`
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

        private notifyTaskUpdate(task:any, message:string, color:string = null)
        {
            this.discordBot.sendMessage(message, {
                title: "Task updated",
                fields: [
                    {
                        name: "Task " + task.type,
                        value: this.taskToString(task)
                    }
                ],
                color: color
            })
        }

        private displayTasksList(title:string = "Task list", color:string = null)
        {
            let fields = []
            for (let i = this.tasks.length-1; i>=0; i--)
            {
                let aTask = this.tasks[i]
                fields.push({
                    name: `Task ${i}: ${aTask.type}`,
                    value: this.taskToString(aTask)
                })
            }
            this.discordBot.sendMessage(`${this.tasks.length} on-going tasks`, {
                title: title,
                fields: fields,
                color: color
            })
        }

        private async callBookingApi(url = '', body = "", method = 'POST', getCookies = false, referrer = "") 
        {
            if (referrer != "")
            {
                this.referrer = this.baseUrl+referrer;
            }
            // body = encodeURI(body);
            // Logger.debug("Calling", this.baseUrl+url, method, body, this.currentCookies);
            await this.sleep(350);
            let response = await fetch(this.baseUrl+url, {
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
                Logger.error("Error logging in: ", reply.data);
                return false;
            }
        }


        private async getTokenForSchedule(dateDiffInDays, time, schedule)
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
                return null;
            }
            if (!reply.isJson)
            {
                let csrf_reservation = reply.data.split("csrf_reservation\" value=\"")[1].split("\"")[0];
                return csrf_reservation
            }
            else
            {
                Logger.warning("Unable to get CSRF", reply.data);
                return null;
            }
        }

        private async reserve(date, time, schedule, csrf_reservation)
        {
            let reply = await this.callBookingApi(
                "/reservation/process",
                `action_type=create&choice=with_none&default_date=${date}&default_timestart=${time}&default_timeend=${this.getNextTime(time)}&default_duration=${this.duration}&default_schedule=${schedule}&default_row=0&poll_request_id=0&csrf_reservation=${csrf_reservation}`
            )
            
            if (reply.status == 200 && reply.isJson && reply.data.success)
            {
                Logger.ok("Booked successfully !!!");
                return true;
            }
            else if (reply.status == 200 && reply.isJson && reply.data.alert?.title)
            {
                Logger.ok("Not possible to book slot:", reply.data.alert.title);
                return false;
            }
            else
            {
                Logger.error("Unable to book slot", reply.status, reply.error, reply.data);
                return false;
            }
        }

        private async tryBooking(clubid, credential, date, time)
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
                let dateDiffInDays = this.computeDateDiffInDays(date)
                let csrf_reservation = await this.getTokenForSchedule(dateDiffInDays, timeInMinutes, schedule.value);
                if (csrf_reservation != null)
                {
                    Logger.info(`Trying to book ${date} ${time} on schedule ${schedule.name} with token : ${csrf_reservation}`);
                    let isBooked = await this.reserve(date, time, schedule.value, csrf_reservation);
                    if (isBooked)
                    {
                        return true;
                    }
                }
                else
                {
                    Logger.info("No availabilty for requested date and time");
                }
            }
        }

        private computeDateDiffInDays(requestedDate:string)
        {
            let localDateStr = new Date().toLocaleDateString();
            let localDateObj = new Date(localDateStr + " UTC");

            let localDay = localDateObj.getDate() + 30*(1+localDateObj.getMonth()) + 365*localDateObj.getFullYear();
            let requestedDay = parseInt(requestedDate.split("-")[2]) + 30*parseInt(requestedDate.split("-")[1]) + 365*parseInt(requestedDate.split("-")[0]);
            return requestedDay - localDay
        }

        private async runBookPadelTask(iTask:any)
        {
            if (iTask.status == "pending")
            {
                // Ckeck if we can start trying to book (reservation is opened 7 days before)
                
                let daysDiff = this.computeDateDiffInDays(iTask.date)
                // Logger.debug(`Local day: ${localDay}, Requested day: ${requestedDay}, Diff: ${daysDiff}`)
                if (daysDiff < 0)
                {
                    iTask.status = "abandonned"
                    this.notifyTaskUpdate(iTask, `Abandonned as requested slot is in the past`, "#ff0000")
                }
                else if (daysDiff <= this.daysBeforeBooking)
                {
                    iTask.status = "trying"
                    this.notifyTaskUpdate(iTask, `Reservation should be opened, starting to try to book`)
                }
            }
            if (iTask.status == "trying")
            {
                if (iTask.tries >= 15)
                {
                    iTask.status = "abandonned"
                    this.notifyTaskUpdate(iTask, `Abandonned after ${iTask.tries} tries`, "#ff0000")
                    return
                }
                
                iTask.tries++
                for (let credential of Object.keys(this.credentials))
                {
                    Logger.debug(`Trying to book with '${credential}' credentials, for ${iTask.club} on ${iTask.date} at ${iTask.time}`)
                    let isBooked = await this.tryBooking(this.clubs[iTask.club], this.credentials[credential], iTask.date, iTask.time)
                    if (isBooked)
                    {
                        iTask.status = "done"
                        iTask.result = "Booked with '"+credential+"' account"
                        this.notifyTaskUpdate(iTask, `Booked successfully after ${iTask.tries} tries`, "#00ff00")
                        break;
                    }
                }
            }
        }

        private async startTaskDeamon()
        {
            let thisObj = this
            Logger.info("Starting tasks deamon")
            setInterval(async () => {
                // Logger.debug(`Checking ${thisObj.tasks.length} tasks`)
                for (let i in thisObj.tasks)
                {
                    let aTask = thisObj.tasks[i]
                    if (aTask.type == "book-padel")
                    {
                        thisObj.runBookPadelTask(aTask)
                    }
                }
            }, 3*1000);
        }

        discordBot:any;
        tasks:any;
        currentCookies:any;
        referrer:string;
        daysBeforeBooking:any;
        schedules:any;
        credentials:any;
        allowedTimes:any;
        duration:any;
        clubs:any;
        baseUrl:string;
    }
}

export default PadelBot
