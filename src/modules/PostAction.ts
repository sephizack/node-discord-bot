import Logger from './logger.js'
import Utils from './utils.js'

export class PostAction {
	public constructor(description: string, emoji: string, emojiCount:number, callback: any) {
		this.description = description
		this.emoji = emoji
		this.emojiCount = emojiCount
		this.callback = callback
	}

	public isConfirmed(reaction: any) {
        if (reaction.emoji == this.emoji && reaction.count == this.emojiCount) {
			return true
		}
		return false
    }

	public run() {
		this.callback()
	}
	
	description:string;
	emoji:string;
	emojiCount:number;
	callback:any;
}

export default PostAction
