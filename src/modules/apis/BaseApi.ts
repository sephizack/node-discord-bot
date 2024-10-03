import Logger from '../logger.js'


module apis {
	export abstract class BaseApi {
		public abstract getDaysBeforeBooking();
        public abstract listBookings();
        public abstract listAvailableSlots(date, time, endTime);
        public abstract tryBooking(date, time, endTime);

		public constructor(config:any) {
            this.fullname = config.fullname ? config.fullname : ""
			this.address = config.address ? config.address : ""
        }

		public getFullname()
		{
			return this.fullname
		}

		public getAddress()
		{
			return this.address
		}

        public getLogs()
        {
            return this.executionLogs
        }

		protected async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

		protected resetLogs()
		{
			this.executionLogs = []
		}

        protected addLog(level:string, message:string)
        {
            this.executionLogs.push({
				name: `${new Date().toISOString().split('.')[0].split('T')[1]} - ${level.toUpperCase()}`,
				value: message
			})
        }

		protected notImplemented()
		{
			this.resetLogs()
            this.addLog("error", "Not yet implemented")
			return null
		}

		private executionLogs = []
		protected address: any;
		protected fullname: any;
	}
}

export default apis.BaseApi;