import Discord from 'discord.js'
import Logger from '../modules/logger.js'
import PostAction from './PostAction.js'
import Utils from './utils.js'
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
            this.postActionMap = new Map()
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

                let pres:Discord.PresenceData = {}
                pres.status = 'online';
                pres.activities = [{
                    name: '🎾 🎬 🇯🇵',
                    type: Discord.ActivityType.Custom
                }];

                this.client.user.setPresence(pres);

            });
            this.client.on('disconnect', () => {
                this.isConnected = false
            });
            this.client.on(Discord.Events.MessageCreate, message => {
                // Ignore if message is not in a channel we are monitoring
                if (this.channelIDsToNotify.indexOf(message.channelId) == -1) {
                    return
                }
                this.handleSpecialMessage(message)
            });
            this.client.on(Discord.Events.MessageReactionAdd, (event, user) => {
                if (this.channelIDsToNotify.indexOf(event.message.channelId) == -1) {
                    return
                }
                this.handleReactionAddition(event, user)
            });
            this.client.on(Discord.Events.InteractionCreate, interaction => {
                if (interaction.isButton())
                {
                    let buttonInteraction:Discord.ButtonInteraction = interaction
                    if (this.channelIDsToNotify.indexOf(buttonInteraction.message.channelId) == -1) {
                        return
                    }
                    this.handleButtonInteraction(buttonInteraction)
                }

                if (interaction.isModalSubmit())
                {
                    let modalInteraction:Discord.ModalSubmitInteraction = interaction
                    if (this.channelIDsToNotify.indexOf(modalInteraction.message.channelId) == -1) {
                        return
                    }
                    this.handleModalSubmit(modalInteraction)
                }
            });
        }
        
        private async handleModalSubmit(modalInteraction: Discord.ModalSubmitInteraction<Discord.CacheType>) {
            let postAction = this.postActionMap.get(modalInteraction.customId)
            if (postAction == null)
            {
                Logger.warning(this.prefix(), "No post action found for", modalInteraction.customId)
                return
            }
            // set inputs into post action
            modalInteraction.components.forEach((actionRow) => {
                actionRow.components.forEach((component) => {
                    postAction.setProvidedInput(component.customId, component.value)
                });
            });

            if (postAction.isInputMissing())
            {
                let embed = new Discord.EmbedBuilder()
                    .setTitle(`Some inputs are still missing for action **${postAction.description}**`)
                    .setDescription(`Expected inputs: ${postAction.expectedInputs.map((input) => input.id).join(", ")}\nProvided inputs: ${Object.keys(postAction.providedInputs).join(", ")}`)
                    .setColor('#911515');
                let interactionConfirmation:Discord.InteractionReplyOptions = {
                    embeds: [embed],
                    ephemeral: true
                }
                return await modalInteraction.reply(interactionConfirmation)
            }
            
            await this.runPostAction(modalInteraction, postAction)
        }

        private async handleButtonInteraction(buttonInteraction: Discord.ButtonInteraction<Discord.CacheType>) {
            let isConfirmation = buttonInteraction.customId.indexOf("confirm_") == 0
            let postActionId = buttonInteraction.customId.replace("confirm_", "")
            let postAction = this.postActionMap.get(postActionId)
            if (postAction == null)
            {
                Logger.warning(this.prefix(), "No post action found for", postActionId)
                return
            }

            if (!postAction.isConfirmationResquested() || isConfirmation)
            {
                if (postAction.expectedInputs && postAction.expectedInputs.length > 0)
                {
                    // Modal
                    postAction.resetInputs();
                    return this.handleGetInputViaModal(buttonInteraction, postAction)
                }
                this.runPostAction(buttonInteraction, postAction)
            }
            else
            {
                let embed = new Discord.EmbedBuilder()
                    .setDescription(`Are you sure you want to **${postAction.description}** ?`)
                    .setColor('#911515');
                let actionRow:any = new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder()
                    .setLabel("Confirm & proceed")
                    .setStyle(Discord.ButtonStyle.Danger)
                    .setCustomId(`confirm_${postActionId}`)
                );
                let interactionConfirmation:Discord.InteractionReplyOptions = {
                    embeds: [embed],
                    components: [actionRow],
                    ephemeral: true
                }
                await buttonInteraction.reply(interactionConfirmation)
            }
        }

        private async runPostAction(interaction: any, postAction: PostAction) {
            if (postAction.isAnnouced()) {
                this.sendMessage(`Action **${postAction.description}** requested by ${interaction.user.displayName}`, {color: '#0099ff'})
            }

            await interaction.deferReply({
                ephemeral: postAction.isEphemeralReply()
            })
            let cb_reply = await postAction.run()
            if (cb_reply)
            {
                await interaction.editReply(cb_reply)
            }
            else
            {
                await interaction.deleteReply()
            }
        }
        
        private handleGetInputViaModal(buttonInteraction: Discord.ButtonInteraction<Discord.CacheType>, postAction: PostAction) {
            // Show Modal
            Logger.debug(this.prefix(), "Showing modal for post action", postAction.description)
            const modal = new Discord.ModalBuilder()
                .setCustomId(buttonInteraction.customId)
                .setTitle('Input required');
            for (let input of postAction.expectedInputs) {

                const inputField = new Discord.TextInputBuilder()
                    .setCustomId(input.id ? input.id : "input")
                    .setLabel(input.label ? input.label : "input")
                    .setPlaceholder(input.placeholder ? input.placeholder : "")
                    .setValue(input.value ? input.value : "")
                    .setRequired(true)
                    .setStyle(Discord.TextInputStyle.Short);
                const actionrow:any = new Discord.ActionRowBuilder().addComponents(inputField);
                modal.addComponents(actionrow);
            }
            buttonInteraction.showModal(modal);
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

            let actionRows = []
            let actionRow = new Discord.ActionRowBuilder();
            let hasButtons = false
            if (options.buttons)
            {
                for (let aButton of options.buttons) {
                    let button = new Discord.ButtonBuilder();
                    button.setLabel(aButton.label)
                    button.setEmoji(aButton.emoji)
                    if (aButton.url)
                    {
                        button.setStyle(Discord.ButtonStyle.Link)
                        button.setURL(aButton.url)
                    }
                    else if (aButton.callback)
                    {
                        let actionDescription = aButton.actionDescription ? aButton.actionDescription : aButton.label
                        button.setStyle(aButton.isSecondary ? Discord.ButtonStyle.Secondary : Discord.ButtonStyle.Primary)
                        if (aButton?.options?.needsConfirmation)
                        {
                            button.setStyle(Discord.ButtonStyle.Danger)
                        }
                        let postActionId = Utils.getNewTokenForMap(this.postActionMap, 26)
                        let postAction = new PostAction(actionDescription, '', 1, aButton.callback, aButton.options)
                        this.postActionMap.set(postActionId, postAction)
                        Logger.debug(this.prefix(), "Post action created", postActionId)
                        button.setCustomId(postActionId)
                    }
                    else
                    {
                        throw new Error("Button must have either a URL or a callback")
                    }
                    actionRow.addComponents(button)
                    hasButtons = true
                    if (actionRow.components.length == 5)
                    {
                        actionRows.push(actionRow)
                        actionRow = new Discord.ActionRowBuilder();
                    }
                }
            }

            if (options.image)
            {
                message.setImage(options.image)
            }

            if (actionRow.components.length > 0)
            {
                actionRows.push(actionRow)
            }

            // Send message
            for (let aChannel of this.channelsToNotify) {
                if (hasButtons)
                {
                    aChannel.send({ embeds: [message] , components: actionRows})
                }
                else
                {
                    aChannel.send({ embeds: [message]})
                }
            }
        }

        private handleSpecialMessage(message)
        {
            if (message.author && message.author.discriminator == this.client.user.discriminator)
            {
                return
            }
            if (message.mentions.users.has(this.client.user.id)) {
                message.content = message.content.replace(/<@.*>/, "").trim()
                this.userActionCallback("mention", message.content)
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
        client: Discord.Client;
        channelsToNotify:any;
        userActionCallback:any;
        channelIDsToNotify:string[];
        postActionMap:Map<String, PostAction>;
    }

}

export default DiscordBot