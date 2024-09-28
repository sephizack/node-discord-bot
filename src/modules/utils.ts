module Utils {
    
    export function computeDateDiffInDays(requestedDate:string)
    {
        let localDateStr = new Date().toLocaleDateString();
        let localDateObj = new Date(localDateStr + " UTC");

        let localDay = localDateObj.getDate() + 30*(1+localDateObj.getMonth()) + 365*localDateObj.getFullYear();
        let requestedDay = parseInt(requestedDate.split("-")[2]) + 30*parseInt(requestedDate.split("-")[1]) + 365*parseInt(requestedDate.split("-")[0]);
        return requestedDay - localDay
    }

    export const TASK_EXEC_RESULT = {
        RETRY: 0,
        DONE: 1,
        ABORT: 2
    }
}

export default Utils