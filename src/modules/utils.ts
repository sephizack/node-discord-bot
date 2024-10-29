module Utils {
    
    export function computeDateDiffInDays(requestedDate:string)
    {
        let localDateStr = new Date().toISOString().split('T')[0];
        let localDateObj = new Date(localDateStr + " UTC");

        let localDay = localDateObj.getDate() + 30*(1+localDateObj.getMonth()) + 365*localDateObj.getFullYear();
        let requestedDay = parseInt(requestedDate.split("-")[2]) + 30*parseInt(requestedDate.split("-")[1]) + 365*parseInt(requestedDate.split("-")[0]);
        return requestedDay - localDay
    }
    
    const kDaysList = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    export function getDayStringFromNumber(dayId : number)
    {
        return kDaysList[dayId]
    }

    export const TASK_EXEC_RESULT = {
        RETRY: 0,
        DONE: 1,
        ABORT: 2
    }


    export function getNewTokenForMap(map, size)
    {
        var ret = genRandStr(size);
        while (map[ret]) ret = genRandStr(size);
        return ret
    }

    function genRandStr(length)
    {
        var requestedLength = length ? length : 20;
        var result           = '';
        var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        var charactersLength = characters.length;
        for (var i=0; i<requestedLength; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
}

export default Utils