module Utils {
    
    export function computeDateDiffInDays(requestedDateStr :string)
    {
        let d = new Date();
        let localDateStr = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
        let localDateObj = new Date(localDateStr + " UTC");
        let requestedDate = new Date(requestedDateStr + " UTC");

        let daysDiff = Math.floor((requestedDate.getTime() - localDateObj.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff
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
        var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (var i=0; i<requestedLength; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
}

export default Utils