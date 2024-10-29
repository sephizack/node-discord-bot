import Logger from './modules/logger.js'
import DiscordBot from './modules/discord_bot.js'
import BookingBot from './modules/bookingBot.js'

import config from 'config';


Logger.info("Discord Notifier starting...")

if (!config.has("DiscordsBots")) {
    Logger.warning("You must provide the config 'DiscordsBots'")
    process.exit(1);
}

let aBookingBot = null;
function discordActionDispatcher(name, type, data)
{
    if (name == "AutoBookPadel")
    {
        if (type == "connected")
        {
            aBookingBot = new BookingBot.BookingBot(allDiscordsBots["AutoBookPadel"], config.get("BookingBot"))
        }
        if (aBookingBot == null)
        {
            Logger.info("Discord bot not ready yet")
            return
        }
        if (type == "message" || type == "reaction")
        {
            aBookingBot.handleAction(type, data)
        }
    }
    else
    {
        Logger.warning("Discord bot not found")
    }
}

// Initialize Discord clients
let allDiscordsBots = {}
for (let discordSetup of config.get("DiscordsBots")) {
    if (discordSetup.type == "YOUR_TYPE") {
        continue
    }
    let aDiscordBot = new DiscordBot.BaseDiscordBot(
        discordSetup.token,
        discordSetup.notify,
        (type, data) => {
            discordActionDispatcher(discordSetup.name, type, data)
        }
    )
    allDiscordsBots[discordSetup.name] = aDiscordBot
}


// setTimeout(() => {
//     console.log("Sending fake message")
//     discordActionDispatcher('AutoBookPadel', 'message', '!task book allin 02NOV 18:30')
// }, 5000)


