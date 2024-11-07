import Logger from '../modules/logger.js'
import Utils from './utils.js'
import Discord from 'discord.js'

export class PostAction {
    
	public constructor(description: string, emoji: string, emojiCount:number, callback: any, options: any) {
		this.description = description
		this.emoji = emoji
		this.emojiCount = emojiCount
		this.callback = callback
		this.isExecuted = false
		this.needsConfirmation = options && options.needsConfirmation ? options.needsConfirmation : false
		this.announcement = options && options.announcement ? options.announcement : false
		this.ephemeralReply = options && options.ephemeralReply ? options.ephemeralReply : false
		this.executeOnlyOnce = options && options.executeOnlyOnce ? options.executeOnlyOnce : false
		this.expectedInputs = options && options.inputs ? options.inputs : []
		this.providedInputs = {}
	}

	public isConfirmationResquested() {
		return this.needsConfirmation
	}

	public isAnnouced() {
		return this.announcement
	}

	public isEphemeralReply() {
		return this.ephemeralReply
	}

	public isConfirmed(reaction: any) {
		if (reaction.emoji == this.emoji && reaction.count == this.emojiCount) {
			return true
		}
		return false
    }

	public setProvidedInput(inputId: string, value: any) {
		this.providedInputs[inputId] = value
	}

	public isInputMissing() {
        for (let input of this.expectedInputs) {
			if (this.providedInputs[input.id] == undefined) {
				return true
			}
		}
		return false
    }

	public resetInputs() {
		this.providedInputs = {}
    }

	public async run() : Promise<any> {
		if (this.isExecuted && this.executeOnlyOnce) {
			Logger.info("PostAction", "Action already executed, skipping")
			return
		}
		this.isExecuted = true
		return await this.callback(this.providedInputs)
	}
	
	description:string;
	emoji:string;
	emojiCount:number;
	callback:any;
	isExecuted:boolean;
	needsConfirmation:boolean;
	announcement:boolean;
	ephemeralReply:boolean;
	executeOnlyOnce:boolean;
	public expectedInputs:any;
	public providedInputs:any;
}

export default PostAction
