import Logger from './modules/logger.js'
import DiscordBot from './discord/discord_bot.js'
import BookingBot from './modules/bookingBot.js'
import ZtBot from './modules/ztBot.js'

import config from 'config';


Logger.info("Discord Notifier starting...")

if (!config.has("DiscordsBots")) {
    Logger.warning("You must provide the config 'DiscordsBots'")
    process.exit(1);
}

function createUserBotForType(type, discordBot, config)
{
    switch (type)
    {
        case "booking":
            return new BookingBot.BookingBot(discordBot, config)
        case "zt":
            return new ZtBot.ZtBot(discordBot, config)
        default:
            Logger.warning(`Type ${type} not supported`)
            return null
    }
}

function discordActionDispatcher(name, type, data)
{
    let botConf = allDiscordsBots[name]
    if (botConf == null)
    {
        Logger.warning(`Discord bot for ${name} not found`)
        return
    }

    let userBot = botConf.userBot
    if (type == "connected")
    {
        let userBotConf = config.get(botConf.connectsTo)
        if (userBotConf == null)
        {
            Logger.warning(`User bot for ${botConf.connectsTo} not found`)
            return
        }
        let userBotType = userBotConf.botType
        userBot = botConf.userBot = createUserBotForType(userBotType, botConf.discordBot, userBotConf)
    }
    if (userBot == null)
    {
        Logger.info("Discord bot not ready yet")
        return
    }
    if (type != "connected")
    {
        userBot.handleAction(type, data)
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
    allDiscordsBots[discordSetup.name] = {
        discordBot: aDiscordBot,
        connectsTo: discordSetup.connectsTo,
        userBot: null
    }
}


// setTimeout(() => {
//     console.log("Sending fake message")
//     discordActionDispatcher('AutoBookPadel', 'message', '!task book allin 02NOV 18:30')
// }, 5000)


