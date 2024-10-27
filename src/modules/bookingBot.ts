import Logger from './logger.js'
import Utils from './utils.js'
import { CronJob } from 'cron';
import BalleJauneApi from './apis/BalleJauneApi.js'
import PostAction from './PostAction.js'
import DoinSportApi from './apis/DoinSportApi.js'
import BaseApi from './apis/BaseApi.js';


namespace BookingBot {
    const _postActionPrefix = "Post Action "
    export class BookingBot {
        public constructor(discordBot: any, configData:any) {
            this.discordBot = discordBot
            this.tasks = []
            this.allowedTimes = configData.allowedTimes
            this.postActionMap = new Map()

            this.clubs = {}
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
                    this.clubs[clubName] = new BalleJauneApi(configClub)
                }
                else if (configClub.apiType == "allin")
                {
                    this.clubs[clubName] = new DoinSportApi(configClub)
                    if (configClub.autoMonitor && configClub.autoMonitor.enabled)
                    {
                        this.autoMonitor(clubName, configClub.autoMonitor)
                        startUpAnnounceFields.push({
                            name: `Auto-monitoring running for ${this.getClubFullName(clubName)}`,
                            value: `Trying to find available slots at ${configClub.autoMonitor.targetTime}`
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
            let aBookingBot = this;
            new CronJob(
                autoMonitor.runCrontime,
                async function () {
                    aBookingBot.handleAutoMonitorOccurence(clubName, autoMonitor);
                },
                null,
                true,
                'Europe/Paris'
            );
        }

        private async handleAutoMonitorOccurence(clubName: string, autoMonitor: any) {
            let clubsFullName = this.getClubFullName(clubName);
            let clubBookingObject = this.clubs[clubName];
            Logger.info(`Running auto-monitor for ${clubsFullName}`)
            let availableSlots = []
            try {
                for (let dayOffset of autoMonitor.daysOffset)
                {
                    let newAvail = await this.getAvailableSlots(clubName, autoMonitor, dayOffset);
                    availableSlots.push(...newAvail)
                }

                let existingBookings = await clubBookingObject.listBookings()
                if (existingBookings != null)
                {
                    let tomorrowDate = new Date()
                    tomorrowDate.setDate(tomorrowDate.getDate() + 1)
                    let tomorrowDateStr = tomorrowDate.toISOString().split('.')[0].split('T')[0];
                    for (let existingBooking of existingBookings)
                    {
                        if (existingBooking.date == tomorrowDateStr)
                        {
                            // Remind existing booking + remove from available slots
                            Logger.info(`Existing booking found for tomorrow at ${clubsFullName}`)
                            let fields = []
                            fields.push({
                                name: existingBooking.title,
                                value: existingBooking.description
                            })
                            this.addPostAction(fields, '❌', 1, "cancel reservation", () => {
                                this.cancelBookingForDate(clubBookingObject, existingBooking)
                            })

                            this.notifyWithFields("🎾 " + clubsFullName + " reminder", "Don't forget your gear for tomorrow's session 😉", "#00ff15", fields)
                        }
                        // Remove already booked days
                        let newAvailableSlots = []
                        let didRemove = false
                        for (let slot of availableSlots)
                        {
                            if (slot.date != existingBooking.date)
                            {
                                Logger.info(`Keeping available slots on ${slot.date} as it differs from existing booking date ${tomorrowDateStr}`)
                                newAvailableSlots.push(slot)
                            }
                            else
                            {
                                didRemove = true
                                Logger.info(`Removing available slots on ${slot.date} as we have an existing booking`)
                            }
                        }
                        if (didRemove)
                        {
                            availableSlots = newAvailableSlots
                        }
                    }
                }
                else
                {
                    Logger.error(`Auto-monitor for ${clubsFullName} failed`)
                    this.notifyWithFields("Auto Monitoring "+clubsFullName, "Unable to list existing bookings", "#ff0000", clubBookingObject.getLogs())
                    return
                }
            }
            catch (e)
            {
                Logger.error(`Auto-monitor for ${clubsFullName} failed`, e)
                this.notifyWithFields("Auto Monitoring "+clubsFullName, "Unexpected failure", "#ff0000", [{name: "Exception", value: e}])
                return
            }

            if (availableSlots.length == 0)
            {
                Logger.info(`No interesting slots found for ${clubsFullName} at ${autoMonitor.targetTime}`)
                return
            }

            Logger.info(`${availableSlots.length} Available slots found for ${clubsFullName}`)
            let availableSlotsByDate = {}
            for (let slot of availableSlots)
            {
                if (!availableSlotsByDate[slot.date])
                {
                    availableSlotsByDate[slot.date] = []
                }
                availableSlotsByDate[slot.date].push(slot)
            }

            for (let date in availableSlotsByDate)
            {
                let anySlotForDate = availableSlotsByDate[date][0]
                let fields = []
                fields.push({
                    name: anySlotForDate.name,
                    value: anySlotForDate.value
                })
                this.addPostAction(fields, '👍', 1, "book slot", () => {
                    this.tasks.push(
                        {
                            type: "book",
                            club: clubName,
                            date: anySlotForDate.date,
                            time: anySlotForDate.time,
                            duration: 90,
                            tries: 0,
                            status: "pending"
                        }
                    )
                })
                this.notifyWithFields("Available slot that might interests you", `At ${clubsFullName}`, "#00ff00", fields);
            }
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

        public handleAction(type:string, data: any) {
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
                        this.discordBot.sendMessage(`Sample of possible instructions\nAvailable clubs: ${Object.keys(this.clubs).join(', ')}`, {
                            title: "Help",
                            fields: [
                                {
                                    name: "!task book <club-name> 25MAR 18:30",
                                    value: "Book at 18h00 on 25th of March."
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
            else if (type == "reaction")
            {
                // Check if fields contains a post-action id 
                let fields = data.message.fields ? data.message.fields : []
                let postActionId = null
                for (let aField of fields)
                {
                    if (aField.name.indexOf(_postActionPrefix) == 0)
                    {
                        try {
                            postActionId = aField.name.replace(_postActionPrefix, "")
                            break;
                        }
                        catch (e)
                        {
                            Logger.error("Error while parsing postActionId", e)
                        }
                    }
                }
                Logger.debug("Post action id found: ", postActionId)
                if (postActionId !== null)
                {
                    let postAction = this.postActionMap.get(postActionId)
                    if (postAction)
                    {
                        try {
                            this.handlePostActionReaction(postActionId, postAction, data.reaction)
                        }
                        catch (e)
                        {
                            Logger.error("Error while handling post action in BOT", e)
                        }
                    }
                    else
                    {
                        Logger.error("Post action not found")
                    }
                }
                
            }
        }

        private addPostAction(fields: any[], emoji:string, count:number, description:string, postactionCallback:any) {
            // Generate post action id as hash
            let postActionId = Utils.getNewTokenForMap(this.postActionMap, 6)
            let postAction = new PostAction(description, emoji, count, postactionCallback)
            this.postActionMap.set(postActionId, postAction)
            let countStr = ""
            if (count > 1)
            {
                countStr = ` (${count} in total)`
            }
            fields.push({
                name: _postActionPrefix+postActionId,
                value: `React with ${emoji}${countStr} to **${description}**`
            })
        }

        private handlePostActionReaction(postActionId:number, postAction: PostAction, reaction: any) {
            if (postAction.isConfirmed(reaction))
            {
                this.notifyWithFields(`Executing Post action ${postActionId} ...`, `description: ${postAction.description}`, "#777777", [])
                try {
                    postAction.run()
                }
                catch (e)
                {
                    Logger.error("Error while running post action callback", e)
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
                this.notifyWithFields("Existing bookings at "+this.getClubFullName(clubName), "Unable to list bookings", "#ff9100", clubBookingObject.getLogs())
                return
            }
            if (bookings.length == 0)
            {
                this.notifyWithFields("Existing bookings at "+this.getClubFullName(clubName), "No bookings found", "#cecb22", [])
                return
            }

            for (let booking of bookings)
            {
                let fields = []
                fields.push({
                    name: booking.title,
                    value: booking.description + "\n" + this.generateAddToCalendarLink(clubBookingObject, booking)
                })
                this.addPostAction(fields, '❌', 1, "cancel reservation", () => {
                    this.cancelBookingForDate(clubBookingObject, booking)
                })
                this.notifyWithFields("Existing booking found", `At ${this.getClubFullName(clubName)}`, "#00fbff", fields)
            }
        }

        private async cancelBookingForDate(clubBookingObject: BaseApi, booking: any) {    
            let isCanceled = await clubBookingObject.cancelBooking(booking);
            if (isCanceled)
            {
                this.notifyWithFields("Booking canceled", `At ${clubBookingObject.getFullname()} on ${booking.date}`, "#00ff00", [])
            }
            else
            {
                this.notifyWithFields("Booking cancelation failed", `At ${clubBookingObject.getFullname()}`, "#ff0000", clubBookingObject.getLogs())
            }
        }

        private generateAddToCalendarLink(club:any, booking:any)
        {
            let url = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
            url += '&text=' + encodeURIComponent(`🎾 Padel ${club.getFullname()}`);
            url += '&details=' + encodeURIComponent(`Terrain ${booking.playground} - ${booking.description}`);
            url += '&dates=' + encodeURIComponent(booking.date.replace(/-/g,'') + 'T' + booking.time.replace(/:/g,'') + '')
            url += '/' + encodeURIComponent(booking.endDate.replace(/-/g,'') + 'T' + booking.endTime.replace(/:/g,'') + '');
            if (club.getAddress())
            {
                url += '&location=' + encodeURIComponent(club.getAddress());
            }
            return `[Add to Google Agenda](${url})`
        }
        
        private getClubFullName(clubName: string)
        {
            let fullname = this.clubs[clubName].getFullname()
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
            if (!fields || fields.length == 0)
            {
                fields = null
            }
            if (message.length == 0)
            {
                message = " "
            }
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
                
                let daysDiff = Utils.computeDateDiffInDays(iTask.date)
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
                    if (isBooked == Utils.TASK_EXEC_RESULT.DONE)
                    {
                        iTask.status = "done"
                        iTask.result = "Booked successfully"
                        this.notifyTaskMessage(iTask, `Booked successfully at '${iTask.club}' after ${iTask.tries} tries`, "#00ff00")
                        this.listBookingsForClub(iTask.club)
                    }
                    else if (isBooked == Utils.TASK_EXEC_RESULT.ABORT)
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
        allowedTimes:any;
        postActionMap:Map<String, PostAction>;
    }
}

export default BookingBot
