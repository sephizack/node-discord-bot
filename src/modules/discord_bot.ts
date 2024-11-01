import Discord from 'discord.js'
import Logger from './logger.js'
import config from 'config';
import https from 'https'

module DiscordBot {


    export class BaseDiscordBot {
        public constructor(token: string, notifyConfig:any, userActionCallback:any) {
            this.client = new Discord.Client({
                intents: [Discord.GatewayIntentBits.MessageContent
                        ,Discord.GatewayIntentBits.GuildMessages
                        ,Discord.GatewayIntentBits.GuildMessageReactions
                        ,Discord.GatewayIntentBits.DirectMessages
                        ,Discord.GatewayIntentBits.GuildIntegrations
                        ,Discord.GatewayIntentBits.Guilds]
                
            });
            this.channelsToNotify = []
            this.userActionCallback = userActionCallback
            this.botUsername = "(not logged)"
            this.channelIDsToNotify = []
            for (let aNotifyAction of notifyConfig) {
                if (aNotifyAction['channel']) {
                    this.channelIDsToNotify.push(aNotifyAction['channel'])
                }
            }
            this.setupClient()

            let thisBot = this;
            let discordLogin = () => {
                if (!thisBot.isConnected) {
                    Logger.info(thisBot.prefix(), "Appempting connection to discord")
                    thisBot.client.login(token).catch((error) => {
                        Logger.error(thisBot.prefix(), "Unable to conect to Discord", error)
                        thisBot.isConnected = false
                    });
                }
            }
            discordLogin();
            setInterval(discordLogin, 2*60*1000);
        }


        private setupClient() {
            this.client.on('ready', async () => {
                this.isConnected = true
                this.botUsername = this.client.user.username
                Logger.ok(this.prefix(), `Sucessfully logged in as ${this.client.user.tag} ! (Discriminator: ${this.client.user.discriminator})`);
                //Logger.debug(this.prefix(), this.client);
                await this.getChannels()
                this.userActionCallback("connected", "")
            });
            this.client.on('disconnect', () => {
                this.isConnected = false
            });
            this.client.on(Discord.Events.MessageCreate, message => {
                this.handleSpecialMessage(message)
            });
            this.client.on(Discord.Events.MessageReactionAdd, (event, user) => {
                this.handleReactionAddition(event, user)
            });
        }
        
        public sendMessage(content:string, options:any = {}) {
            let message = new Discord.EmbedBuilder();
            message.setDescription(content)
            if (options.color)
            {
                message.setColor(options.color)
            }
            else
            {
                message.setColor('#0099ff')
            }
            if (options.title)
            {
                message.setTitle(options.title)
            }
            if (options.fields)
            {
                for (let aField of options.fields) {
                    message.addFields({
                        name: aField.name,
                        value: aField.value
                    })
                }
            }

            // Send message
            for (let aChannel of this.channelsToNotify) {
                aChannel.send({ embeds: [message]})
            }
        }

        private handleSpecialMessage(message)
        {
            if (message.author && message.author.discriminator == this.client.user.discriminator)
            {
                return
            }
            if (message.content.indexOf("!") == 0) {
                this.userActionCallback("message", message.content)
            }
        }


        private handleReactionAddition(event: any, user: any) {
            try {
                if (event.message.embeds.length == 0)
                {
                    Logger.info(this.prefix(), "handleReactionAddition: No embeds found in message", event.message)
                    return
                }

                // Logger.debug(this.prefix(), "Reaction message", event.message.embeds)
                let reaction_callback_data = {
                    message: {
                        description : event.message.embeds[0].data.description,
                        title: event.message.embeds[0].data.title,
                        fields:  event.message.embeds[0].data.fields,
                        color: event.message.embeds[0].data.color
                    },
                    reaction: {
                        emoji: event._emoji.name,
                        count: event.count
                    }
                }
                Logger.debug(this.prefix(), "Reaction callback data", reaction_callback_data)
                this.userActionCallback("reaction", reaction_callback_data)
            } catch (error) {
                Logger.error(this.prefix(), "Error handling reaction", error)
            }
        }

        private async getChannels() {
            this.channelsToNotify = []
            for (let aChannelId of this.channelIDsToNotify) {
                try {
                    let channel = await this.client.channels.fetch(aChannelId);
                    this.channelsToNotify.push(channel)
                    Logger.ok(this.prefix(), `Channel with ID '${aChannelId}' ready to be notified`)
                } catch (error) {
                    Logger.warning(this.prefix(), `Channel with ID '${aChannelId}' not found:`, error)
                }
            }
        }

        private prefix() {
            return `[Discord ${this.botUsername}]`
        }

        isConnected: boolean;
        botUsername:string
        client:any;
        channelsToNotify:any;
        userActionCallback:any;
        channelIDsToNotify:string[];
    }

}

export default DiscordBot
