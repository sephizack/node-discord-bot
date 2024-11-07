import Logger from '../logger.js'
import BaseApi from './BaseApi.js'
import Utils from '../../discord/utils.js'
import setCookie from 'set-cookie-parser'

namespace apis {
	export class BalleJauneApi extends BaseApi
    {
        public constructor(config:any) {
            super(config)
            this.apiUrl = config.apiUrl
            this.schedules = config.schedules
            this.credentials = config.credentials
            this.daysBeforeBooking = config.daysBeforeBooking
            this.clubId = config.clubId
            this.duration = 90
            this.currentCookies = {}
        }

        public getDaysBeforeBooking()
        {
            return this.daysBeforeBooking;
        }

        public async listBookings()
        {
            this.resetLogs()
            this.addLog("error", "Not yet implemented for BalleJaune API")
        }

        public async listAvailableSlots(date, time, endTime)
        {
            this.resetLogs()
            this.addLog("error", "Not yet implemented for BalleJaune API")
        }

        public async cancelBooking(booking)
        {
            this.resetLogs()
            this.addLog("error", "Not yet implemented for BalleJaune API")
        }

        public async tryBooking(date, time, endTime)
        {
            this.resetLogs()
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
                        return Utils.TASK_EXEC_RESULT.DONE;
                    }
                }
            }
            catch (e)
            {
                Logger.error("Unknown exception while trying to book", e);
                this.addLog("error", "Unknown exception while trying to book: "+e)
                return Utils.TASK_EXEC_RESULT.ABORT;
            }
            return Utils.TASK_EXEC_RESULT.RETRY;
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
                let dateDiffInDays = Utils.computeDateDiffInDays(date)
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
    }
}

export default apis.BalleJauneApi;