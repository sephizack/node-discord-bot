import Logger from './modules/logger.js'
import DiscordBot from './modules/discord_bot.js'
import PadelBot from './modules/padel.js'

import config from 'config';


Logger.info("Discord Notifier starting...")

if (!config.has("DiscordsBots")) {
    Logger.warning("You must provide the config 'DiscordsBots'")
    process.exit(1);
}

let aPadelBot = null;
function discordActionDispatcher(name, type, data)
{
    if (name == "AutoBookPadel")
    {
        if (type == "connected")
        {
            aPadelBot = new PadelBot.PadelBot(allDiscordsBots["AutoBookPadel"], config.get("PadelBot"))
        }
        if (aPadelBot == null)
        {
            Logger.info("Discord bot not ready yet")
            return
        }
        if (type == "message")
        {
            aPadelBot.handleAction(type, data)
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
//     discordActionDispatcher('AutoBookPadel', 'message', '!task list-bookings allin')
// }, 5000)


