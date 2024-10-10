import Logger from '../logger.js'
import BaseApi from './BaseApi.js'
import Utils from '../utils.js'
import setCookie from 'set-cookie-parser'

namespace apis {
	export class DoinSportApi extends BaseApi {
        public constructor(config:any) {
            super(config)
            this.apiUrl = config.apiUrl
            this.accountName = config.accountName
            this.accountId = config.accountId
            this.user = config.user
            this.password = config.password
            this.clubId = config.clubId
            this.clubWhiteLabel = config.clubWhiteLabel
            this.activityId = config.activityId
            this.daysBeforeBooking = config.daysBeforeBooking
        }

        public getDaysBeforeBooking()
        {
            return this.daysBeforeBooking;
        }

        public async listBookings()
        {
            try {
                this.resetLogs()
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
            this.resetLogs()
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
                    if (slot["dayOfWeek"] == 6 || slot["dayOfWeek"] == 0)
                    {
                        Logger.info("Skipping weekend slot", slot);
                        continue;
                    }
                    availableSlotsFileds.push({
                        name: Utils.getDayStringFromNumber(slot["dayOfWeek"]) + " " + slot["date"],
                        value: `From ${slot["startAt"].replace(":00:00", ":00").replace(":30:00", ":30")} to ${slot["endAt"].replace(":00:00", ":00").replace(":30:00", ":30")}`,
                        playground: slot["playground"],
                        date: slot["date"],
                        time: slot["startAt"].replace(":00:00", ":00").replace(":30:00", ":30")
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

        public async cancelBooking(booking)
        {
            this.resetLogs()
            try {
                let bearerToken = await this.login();
                if (bearerToken == null)
                {
                    return null;
                }
                return await this.cancelBookingById(bearerToken, booking.id);
            }
            catch (e)
            {
                Logger.error("Exception while canceling booking", e);
                this.addLog("error", "Exception while canceling booking: "+e);
                return null;
            }
        }

        public async tryBooking(date, time, endTime)
        {
            this.resetLogs()
            try {
                let bearerToken = await this.login();
                if (bearerToken == null)
                {
                    return Utils.TASK_EXEC_RESULT.RETRY;
                }
                let {availableSlots, alreadyBookedFound} = await this.getAvailableSlots(date, time, endTime, bearerToken);
                if (availableSlots == null || availableSlots.length == 0)
                {
                    if (alreadyBookedFound)
                    {
                        this.addLog("notify", "Everything is booked, no need to try again");
                        return Utils.TASK_EXEC_RESULT.ABORT;
                    }
                    else
                    {
                        return Utils.TASK_EXEC_RESULT.RETRY;
                    }
                }
                let bestSlot = this.selectBestSlot(availableSlots);
                if (bestSlot == null)
                {
                    return Utils.TASK_EXEC_RESULT.ABORT;
                }
                let clubBooking = await this.getClubBooking(bestSlot, bearerToken);
                if (clubBooking == null)
                {
                    return Utils.TASK_EXEC_RESULT.ABORT;
                }
                if (await this.confirmBooking(clubBooking, bearerToken))
                {
                    return Utils.TASK_EXEC_RESULT.DONE;
                }
                else
                {
                    return Utils.TASK_EXEC_RESULT.ABORT;
                }
            }
            catch (e)
            {
                Logger.error("Exception while trying to book", e);
                this.addLog("error", "Exception while trying to book: "+e);
                return Utils.TASK_EXEC_RESULT.ABORT;
            }
        }

        private async cancelBookingById(bearerToken: any, bookingId:string)
        {
            let url = `/clubs/bookings/${bookingId}`
            Logger.info("Canceling booking url", url);
            let reply = await this.callApi(url, {canceled: true}, "PUT", bearerToken);
            if (reply.status != 200 || reply?.isJson == false)
            {
                this.addLog("error", "Error while canceling booking: "+reply.error);
                Logger.error("Error while canceling booking", reply.error);
                return false
            }
            else
            {
                return true
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
                    for (let booking of bookings) // Object ClubBooking
                    {
                        let startAt = booking["startAt"]
                        let endAt = booking["endAt"]
                        let startTime = startAt.split('T')[1].split('+')[0].replace(":00:00", ":00").replace(":30:00", ":30")
                        let endTime = endAt.split('T')[1].split('+')[0].replace(":00:00", ":00").replace(":30:00", ":30")
                        let playgroundName = booking["playgrounds"][0]["name"]
                        bookingsOk.push({
                            title: startAt.split('T')[0] + " on " + playgroundName,
                            description: `From ${startTime} to ${endTime}`,
                            date: startAt.split('T')[0],
                            time: startTime,
                            endDate: endAt.split('T')[0],
                            endTime: endTime,
                            playground: playgroundName,
                            id: booking["id"]
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
            this.addLog("info", `Preparing booking request for slot at ${bestSlot["playground"]} from ${bestSlot["startAt"]} to ${bestSlot["endAt"]} on ${bestSlot["date"]}`);
            let reply = await this.callApi('/clubs/bookings', {
                "timetableBlockPrice": "/clubs/playgrounds/timetables/blocks/prices/"+bestSlot["priceId"],
                "activity": "/activities/"+this.activityId,
                "canceled": false,
                "club": "/clubs/"+this.clubId,
                "startAt": `${bestSlot["date"]} ${bestSlot["startAt"]}`,
                "payments": [],
                "endAt": `${bestSlot["date"]} ${bestSlot["endAt"]}`,
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
                                            dayOfWeek: new Date(`${date} ${startAt}`).getDay(),
                                            date: date,
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
            if (this.lastLoginDate && (Date.now() - this.lastLoginDate) < 1000*60*60){
                this.addLog("notify", "Already logged in, re-use token");
                Logger.info("Already logged in, re-use token");
                return this.lastToken;
            }
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
                this.lastLoginDate = Date.now();
                this.lastToken = reply.data.token;
                return reply.data.token
            }
        }

        private async callApi(url = '', body = {}, method = 'POST', bearerToken = "") 
        {
            await this.sleep(777);
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
        lastLoginDate:any;
        lastToken:any;
        activityId:any;
    }
}

export default apis.DoinSportApi;