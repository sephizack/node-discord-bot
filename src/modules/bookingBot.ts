import Logger from './logger.js'
import Utils from '../discord/utils.js'
import { CronJob } from 'cron';
import BalleJauneApi from './apis/BalleJauneApi.js'
import PostAction from '../discord/PostAction.js'
import DoinSportApi from './apis/DoinSportApi.js'
import BaseApi from './apis/BaseApi.js';


namespace BookingBot {
    const _postActionPrefix = "Post Action "
    export class BookingBot {
        public constructor(discordBot: any, configData:any) {
            this.discordBot = discordBot
            this.tasks = []
            this.allowedTimes = configData.allowedTimes
            this.blacklistesProposalDates = new Set()
            this.autoMonitorConfig = {}

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
                        this.autoMonitorConfig[clubName] = configClub.autoMonitor
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
            this.notifyWithFields("Padel Bot started", "Announces", "#800080", startUpAnnounceFields, this.getHelpButtons())
        }

        private getHelpButtons() {
            return [
                {
                    label: "Request new booking",
                    emoji: "📚",
                    options: {
                        announcement:false,
                        executeOnlyOnce: false,
                        inputs: [
							// {id: "type", label: "Type of search (films, series)", value: "films"},
							{id: "club_name", label: "Club", placeholder: "allin | ballejaune", value: "allin"},
							{id: "date", label: "Date", placeholder: "eg. 25MAR or 12JAN2025"},
                            {id: "time", label: "Time", placeholder: "eg. 18:30", value: "18:30"},
						],
                    },
                    callback: async (inputs) => {
                        this.createBookingTask(inputs['club_name'], this.getCleanedDate(inputs['date']), this.getCleanedTime(inputs['time']));
                    }
                },{
                    label: "List Bookings",
                    emoji: "🗓️",
                    options: {
                        announcement:false,
                        executeOnlyOnce: false
                    },
                    callback: async () => {
                        for (let clubName in this.clubs)
                        {
                            await this.listBookingsForClub(clubName)
                        }
                    }
                },
                {
                    label: "Check Available Slots",
                    emoji: "👟",
                    options: {
                        announcement:false,
                        executeOnlyOnce: false
                    },
                    callback: async () => {
                        let clubName = "allin"
                        let autoMonitor = this.autoMonitorConfig[clubName]
                        // this.notifyWithFields("Checking available slots", `At ${this.getClubFullName(clubName)} at ${autoMonitor.targetTime}`, "#009dff")
                        await this.handleAutoMonitorOccurence(clubName, autoMonitor, true);
                    }
                },
                {
                    label: "Task list",
                    emoji: "📋",
                    options: {
                        announcement:false,
                        executeOnlyOnce: false
                    },
                    callback: () => {
                        this.displayTasksList()
                    }
                },
                {
                    label: "Help",
                    emoji: "❔",
                    options: {
                        announcement:false,
                        executeOnlyOnce: false
                    },
                    callback: () => {
                        this.displayHelp()
                    }
                },
            ]
        }

        private startNextWeekPoll() {
            let afterNextMondayDaysShift = Math.abs((new Date().getDay()-1-7) % 7) + 7
            let afterNextMonday = new Date(Date.now() + afterNextMondayDaysShift * 24 * 60 * 60 * 1000)
            let pollChoices = []
            for (let i = 0; i < 5; i++)
            {
                let day = new Date(afterNextMonday)
                day.setDate(day.getDate() + i)
                let dayStr = day.toISOString().split('T')[0]
                pollChoices.push({
                    text: Utils.getDayStringFromDate(day) + " " + day.getDate(),
                    id: dayStr,
                    cb_data: {date: dayStr}
                })
            }
            
            let daysBooked = []
            this.discordBot.sendPoll("Salut les gars !\nVoici un poll pour pre-book pour la semaine pro 🍺", pollChoices, {
                durationHours: 26,
                remindAfterHours: 20,
                reminderNbUniqueUsersExpected: 4,
                allowMultiselect: true,
                callback: (event_type, message, answers) => {
                    if (event_type == "reminder") {
                        let dayAlmostOk = null
                        answers.forEach((answer) => {
                            if (answer.voteCount == 3)
                            {
                                dayAlmostOk = answer.text
                            }
                        });
                        if (dayAlmostOk)
                        {
                            message.reply(`@everyone Plus qu'un vote pour ${dayAlmostOk} !`, {color: '#0099ff'})
                        }
                        else
                        {
                            message.reply("@everyone Le poll va bientôt se terminer, n'oubliez pas de voter", {color: '#d87919'})
                        }
                    } else if (event_type == "update") {
                        // if one answer has 4 votes we book
                        let daysOk = []
                        answers.forEach((answer) => {
                            Logger.info(`Answer ${answer.text} has ${answer.voteCount} votes`)
                            if (answer.voteCount == 4)
                            {
                                if (!daysBooked.includes(answer.text))
                                {
                                    daysOk.push(answer.text)
                                }
                            }
                        });
                        if (daysBooked.length >= 2 && daysOk.length > 0)
                        {
                            message.reply("Not booking additional days as already 2 have been selected", {color: '#0008ff'})
                            return
                        }
                        for (let day of daysOk)
                        {
                            daysBooked.push(day)
                            this.createBookingTask("allin", day, "18:30")
                        }
                    }
                }
            })
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

        private async handleAutoMonitorOccurence(clubName: string, autoMonitor: any, tellWhenNoSlot = false) {
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
                            let nextWeekDay = new Date()
                            nextWeekDay.setDate(nextWeekDay.getDate() + 8)
                            let nextWeekDayStr = nextWeekDay.toISOString().split('.')[0].split('T')[0];
                            this.notifyWithFields("👟 " + clubsFullName + " reminder", "Don't forget your gear for tomorrow's session 😉", "#00ff15", fields, [
                                {
                                    label: `Re-book next week (${nextWeekDayStr} 18:30)`,
                                    emoji: "👟",
                                    options: {
                                        announcement: true
                                    },
                                    callback: () => {
                                        this.createBookingTask(clubName, nextWeekDayStr, "18:30");
                                    }
                                },
                                {
                                    label: "Cancel Reservation",
                                    emoji: "🗑️",
                                    options: {
                                        needsConfirmation: true,
                                        announcement: true,
                                        executeOnlyOnce:true
                                    },
                                    callback: async () => {
                                        await this.cancelBookingForDate(clubBookingObject, existingBooking)
                                    }
                                }
                            ])
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

            Logger.info(`${availableSlots.length} Available slots found for ${clubsFullName}`)
            let availableSlotsByDate = {}
            for (let slot of availableSlots)
            {
                if (this.blacklistesProposalDates.has(slot.date))
                {
                    Logger.info(`Blacklisted proposal for ${slot.date}`)
                    continue
                }
                if (!availableSlotsByDate[slot.date])
                {
                    availableSlotsByDate[slot.date] = []
                }
                availableSlotsByDate[slot.date].push(slot)
            }

            if (Object.keys(availableSlotsByDate).length == 0)
            {
                Logger.info(`No interesting slots found for ${clubsFullName} at ${autoMonitor.targetTime}`)
                if (tellWhenNoSlot)
                {
                    this.notifyWithFields("No slots found", `At ${clubsFullName} at ${autoMonitor.targetTime}`, "#ff0000")
                }
                return
            }
    
            for (let date in availableSlotsByDate)
            {
                let anySlotForDate = availableSlotsByDate[date][0]
                let fields = []
                fields.push({
                    name: anySlotForDate.name,
                    value: anySlotForDate.value
                })
                this.notifyWithFields("Available slot that might interests you", `At ${clubsFullName}`, "#00ff00", fields, [
                    {
                        label: `Book`,
                        emoji: "👟",
                        options: {
                            announcement: true
                        },
                        callback: () => {
                            this.createBookingTask(clubName, anySlotForDate.date, anySlotForDate.time);
                        }
                    },
                    {
                        label: `Blacklist ${anySlotForDate.date}`,
                        emoji: "🏴",
                        options: {
                            needsConfirmation: true
                        },
                        callback: () => {
                            this.blacklistesProposalDates.add(anySlotForDate.date)
                            Logger.info(`Blacklisted next proposals for ${anySlotForDate.date}`)
                            this.notifyWithFields("Blacklisted date", `No more proposals for ${anySlotForDate.date}`, "#00ff00")
                        }
                    }
                ]);
            }
            // On Saturday propose poll
            let today = new Date()
            if (today.getDay() == 6)
            {
                this.startNextWeekPoll()
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
            if (type == "mention")
            {
                type = "message"
                data = '!task ' + data
            }
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
                        this.displayHelp()
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
                // Nothing to-do
            }
        }

        private displayHelp() {
            this.discordBot.sendMessage(`Sample of possible instructions\nAvailable clubs: ${Object.keys(this.clubs).join(', ')}`, {
                title: "Help",
                fields: [
                    {
                        name: "!task book <club-name> 25MAR 18:30",
                        value: "Book at 18h00 on 25th of March."
                    },
                    {
                        name: "!task book 25MAR",
                        value: "Book with default All-in and 18:30."
                    },
                    {
                        name: "!task list-bookings <club-name>",
                        value: "List bookings done club-name."
                    },
                    {
                        name: "!rmtask i",
                        value: "Remove task with index i"
                    },
                    {
                        name: "!tasklist",
                        value: "List all tasks"
                    }
                ],
                buttons: this.getHelpButtons()
            })
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
            if (rawDate.length == 4)
            {
                rawDate = '0'+rawDate
            }
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
                if (taskDataSplit.length == 2)
                {
                    taskDataSplit = ["book", "allin", taskDataSplit[1], "18:30"]
                }
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

                this.createBookingTask(clubName, date, time);
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
                this.displayHelp()
            }
        }

        private createBookingTask(clubName: string, date: string, time: string) {
            //check input
            if (!this.clubs[clubName])
            {
                this.discordBot.sendMessage(`Unknown club ${clubName}`, {color:"#ff0000"})
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
            );
            this.displayTasksList(`Task booking '${this.getClubFullName(clubName)}' created`, "#00ff00");
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
                    value: booking.description
                })
                let weekDay = Utils.getDayStringFromDate(new Date(booking.date))
                this.notifyWithFields(`Existing booking on ${weekDay} ${booking.date}`, `At ${this.getClubFullName(clubName)}`, "#00fbff", fields, [
                    {
                        label: "Add to Google Agenda",
                        emoji: "🗓️",
                        url: this.generateAddToCalendarLink(clubBookingObject, booking)
                    },
                    {
                        label: "Cancel Reservation",
                        emoji: "🗑️",
                        options: {
                            announcement: true,
                            needsConfirmation: true,
                        },
                        callback: async () => {
                            await this.cancelBookingForDate(clubBookingObject, booking)
                        }
                    }
                ])
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
            return url;
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

        private notifyWithFields(title:string, message:string, color:string = null, fields:any = null, buttons:any = null)
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
                color: color,
                buttons: buttons
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
            let nb_tasks = 0
            for (let i = this.tasks.length-1; i>=0; i--)
            {
                let aTask = this.tasks[i]
                if (aTask.status == "done" || aTask.status == "abandonned")
                {
                    continue
                }
                nb_tasks++
                fields.push({
                    name: `Task ${i}: ${aTask.type} ${this.getClubFullName(aTask.club)}`,
                    value: this.taskToString(aTask)
                })
            }
            this.discordBot.sendMessage(`${nb_tasks} on-going tasks`, {
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
        blacklistesProposalDates:Set<String>;
        autoMonitorConfig:any;
    }
}

export default BookingBot
