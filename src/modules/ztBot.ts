import Logger from './logger.js'
import Utils from '../discord/utils.js'
import { CronJob } from 'cron';


namespace ZtBot {
	const qualityOrder = ["DVDRIP", "HDRIP", "WEBRiP", "WEBRIP",
		"WEB-DL 720p", "WEBRIP 720p", "HDLIGHT 720p", "BLU-RAY 720p",
		"HDLIGHT 1080p", "WEB-DL 1080p", "BLU-RAY 1080p",
		"BDRIP", "BLURAY REMUX 4K", "4K LIGHT"]
	const Q_720_DEFAULT = "WEB-DL 720p"
	const Q_1080_DEFAULT = "WEB-DL 1080p"
	const Q_4K_DEFAULT = "4K LIGHT"


	type MediaSearchResult = {
		id?: string;
		title?: string;
		url?: string;
		image?: string;
		quality?: string;
		language?: string;
	}
	type DownloadLink = {
		service?: string;
		url?: string;
	}
	type MediaDetails = {
		id?: string;
		url?: string;
		image?: string;
		quality?: string;
		language?: string;

		name?: string;
		synopsis?: string;
		fileName?: string;
		origin?: string;
		duration?: string;
		director?: string;
		productionYear?: string;
		originalTitle?: string;
		review?: string;
		trailerUrl?: string;
		actors?: string[];
		genres?: string[];
		downloadLinks?: DownloadLink[];
		otherVersions?: MediaSearchResult[];
	}

    export class ZtBot {
        public constructor(discordBot: any, configData:any) {
            this.discordBot = discordBot
			this.ztApiUrl = configData.ztApiUrl

            this.discordBot.sendMessage("Use buttons to interact", {
				title: "ZT Bot started",
				color: "#800080",
				fields: [],
				buttons: this.getHelpButtons()
			})
        }

		private getHelpButtons() {
			return [
				{
					label: "Latest Films",
					emoji: "🎥",
					options: {
						
						announcement:false,
						executeOnlyOnce: false
					},
					callback: async (inputs) => {
						await this.handleMediaSearchRequest('', 5, 'films')
					}
				},
				{
					label: "Search Films",
					emoji: "🔍",
					options: {
						inputs: [
							// {id: "type", label: "Type of search (films, series)", value: "films"},
							{id: "search", label: "Search", placeholder: "Search text"},
							{id: "nb_result", label: "Amount of results", value: "2"},
						],
						announcement:false,
						executeOnlyOnce: false
					},
					callback: async (inputs) => {
						await this.handleMediaSearchRequest(inputs['search'], inputs['nb_result'], 'films')
					}
				},
				{
					label: "Search Series",
					emoji: "🔍",
					options: {
						inputs: [
							// {id: "type", label: "Type of search (films, series)", value: "films"},
							{id: "search", label: "Search", placeholder: "Search text"},
							{id: "nb_result", label: "Amount of results", value: "2"},
						],
						announcement:false,
						executeOnlyOnce: false
					},
					callback: async (inputs) => {
						await this.handleMediaSearchRequest(inputs['search'], inputs['nb_result'], 'series')
					}
				},
				{
					label: "Help",
					emoji: "❔",
					options: {
						announcement:false,
						executeOnlyOnce: false
					},
					callback: () => {
						this.displayHelp()
					}
				}
			]
		}



		public async handleAction(type:string, data: any) {
			Logger.debug("ZtBot", "handleAction", type, data)
			if (type == "mention")
			{
				let searchFreetext = data
				if (searchFreetext.indexOf("help") == 0)
				{
					return this.displayHelp()
				}
				let nb_results_max = 2
				let category = "films"

				// Parse search text to extract options
				let searchWords = searchFreetext.split(' ')
				if (!isNaN(parseInt(searchWords[0])))
				{
					nb_results_max = parseInt(searchWords[0])
					searchWords.shift()
				}
				if (searchWords.length > 1 && (searchWords[0] == "films" || searchWords[0] == "series"))
				{
					category = searchWords[0]
					searchWords.shift()
				}

				this.handleMediaSearchRequest(searchWords.join(' '), nb_results_max, category)
			}
		}
		
		private async handleMediaSearchRequest(searchFreetext: string, nb_results_max: number, category: string) {
			
			let reply = await this.callZtApi('/api/search', {
				category: category,
				query: searchFreetext
			});
			if (reply.status != 200 || reply?.isJson == false)
			{
				this.discordBot.sendMessage(`ZT API failed (status: ${reply?.status}, message: ${reply?.error})`, {
					color: "#FF0000"
				})
			}
			else if (reply.data.length == 0)
			{
				this.discordBot.sendMessage(`Aucun résultat trouvé pour ${searchFreetext}`, {
					// color: "#0000"
				})
			}
			else
			{
				let results = this.dedupResults(reply.data)
				if (results.length > nb_results_max)
				{
					let truncTxt = nb_results_max > 1 ? `(seulement les ${nb_results_max} premiers seront affiché)` : "(selement le premier sera affiché)"
					this.discordBot.sendMessage(`${results.length} resultats ${truncTxt}`, {
						color: "#00ff00"
					})
					results = results.slice(0, nb_results_max)
				}
				for (let aSearchResult of results)
				{
					// Retrieve full detials
					let searchData : MediaSearchResult = {
						id: aSearchResult.id,
						title: aSearchResult.title,
						url: aSearchResult.url,
						image: aSearchResult.image,
						quality: aSearchResult.quality,
						language: aSearchResult.language
					}
					let resultDetails : MediaDetails = await this.retrieveDetailsForSearch(searchData)
					if (!resultDetails)
					{
						continue;
					}
					let betterVersion : MediaSearchResult = this.findBetterVersionId(resultDetails)
					if (betterVersion && betterVersion.id != aSearchResult.id)
					{

						resultDetails = await this.retrieveDetailsForSearch(betterVersion)
					}

					this.displayResultCard(resultDetails)
				}
			}

		}

		private displayHelp() {
			this.discordBot.sendMessage(`Bot pour browse le site ZT depuis discord`, {
				title: `ZT Bot Help`,
				description: `Usage: @ZTBot <search>`,
				fields: [
					{
						name: `@ZTBot <search_text>`,
						value: `Recherche un film sur ZT (2 premiers resultats uniquement)`
					},
					{
						name: `@ZTBot <number> <search_text>`,
						value: `Recherche un film sur ZT (<number> premiers resultats)`
					},
					{
						name: `@ZTBot <number> <category> <search_text>`,
						value: `Recherche un media de type <category> sur ZT (<number> premiers resultats)\nCategories: films, series`
					}
				],
				color: "#0000FF",
				buttons: this.getHelpButtons()
			})
		}
		
		private displayResultCardWithSearchData(media: MediaSearchResult) {
			let buttons = []
			if (media.url) {
                buttons.push({
                    label: "ZT Page",
                    emoji: "🔗",
                    url: media.url
                })
            }

			let resultsFields = [
				{
					name: `Details`,
					value: `${media.quality} | ${media.language}`
				}
			]

			this.discordBot.sendMessage(`Not able to find details for media ${media.id}`, {
				title: `${media.title}`,
				fields: resultsFields,
				color: "#FF0000",
				image: media.image,
				buttons: buttons
			})
		}

		private displayResultCard(media: MediaDetails) {
			let resultsFields = [
				{
					name: `Genres`,
					value: `${media.genres.join(" | ")}`
				},
				{
					name: `Directeur`,
					value: `${media.director}`
				},
				{
					name: `Acteurs`,
					value: `${media.actors.join(" | ")}`
				},
				{
					name: `Details`,
					value: `${media.duration} | ${media.quality} | ${media.language} | ${media.origin} | ${media.review}`
				},
				{
					name: `Fichier`,
					value: `${media.fileName}`
				}
			]

			let buttons = []
			if (media.url) {
                buttons.push({
                    label: "ZT Page",
                    emoji: "🔗",
                    url: media.url
                })
            }
            if (media.trailerUrl) {
                buttons.push({
                    label: "Trailer",
                    emoji: "🎬",
                    url: media.trailerUrl
                })
            }
            for (let aLink of media.downloadLinks) {
                if (!aLink.url) {
                    continue;
                }
                buttons.push({
                    label: aLink.service,
                    emoji: "📂",
                    url: aLink.url
                });
            }

			let reviewStars = ""
			if (media.review) {
				let nb_stars = Math.ceil(parseFloat(media.review.split('/')[0]))
				for (let i = 0; i < nb_stars; i++)
				{
					reviewStars += "★"
				}
				// then empty stars
				for (let i = nb_stars; i < 5; i++)
				{
					reviewStars += "☆"
				}
			}
			this.discordBot.sendMessage(media.synopsis, {
				title: `${reviewStars} [${media.productionYear}] ${media.name}`,
				fields: resultsFields,
				color: "#00FF00",
				image: media.image,
				buttons: buttons
			})
		}

		private findBetterVersionId(resultDetails: MediaDetails) : MediaSearchResult {
			let foundBetterVersion = false
			let bestVersion : MediaSearchResult = {
				id: resultDetails.id,
				title: resultDetails.name,
				url: resultDetails.url,
				image: resultDetails.image,
				quality: resultDetails.quality,
				language: resultDetails.language
			} 
			for (let aVersion of resultDetails.otherVersions)
			{
				console.log("Checking quality. Current:", bestVersion.quality, "New:", aVersion.quality)
				if (this.isNewQualityBetter(bestVersion.quality, aVersion.quality))
				{
					console.log("Found better version", aVersion.quality)
					bestVersion = aVersion
					foundBetterVersion = true
				}
			}
			if (foundBetterVersion)
			{
				bestVersion.image = resultDetails.image
				return bestVersion
			}
			return null
		}

		private async retrieveDetailsForSearch(search: MediaSearchResult) : Promise<MediaDetails> {
			let mediaDetails : MediaDetails = {
				id: search.id,
				url: search.url,
				image: search.image,
				quality: search.quality,
				language: search.language
			}

			let apiData = await this.callZtApi('/api/getMovieDetails', {
				id: search.id
			});

			if (apiData.status != 200 || apiData?.isJson == false)
			{
				this.discordBot.sendMessage(`ZT API failed for ID ${search.id} (status: ${apiData?.status})`, {
					color: "#FF0000"
				})
				return null
			}
			let apiDetails = apiData.data.movieInfos;
            let otherVersions = apiData.data.otherVersions;
            console.log("API Details", apiDetails);
            if (!apiDetails) {
                console.error("No details found for ID", search.id, apiData);
                this.displayResultCardWithSearchData(search);
                return null;
            }

			mediaDetails.name = apiDetails.name
			mediaDetails.synopsis = apiDetails.synopsis
			mediaDetails.fileName = apiDetails.fileName
			mediaDetails.origin = apiDetails.origin
			mediaDetails.duration = apiDetails.duration
			try {
				mediaDetails.director = decodeURIComponent(apiDetails.director.split('search=')[1])
			} catch (e) {
				mediaDetails.director = ""
			}
			mediaDetails.productionYear = apiDetails.productionYear
			mediaDetails.originalTitle = apiDetails.originalTitle
			mediaDetails.review = apiDetails.review
			mediaDetails.trailerUrl = apiDetails.trailer
			mediaDetails.actors = []
            if (apiDetails.actors) {
                for (let actor of apiDetails.actors) {
                    mediaDetails.actors.push(actor.name);
                }
            }
            mediaDetails.genres = []
            if (apiDetails.genres) {
                for (let genre of apiDetails.genres) {
                    mediaDetails.genres.push(genre.name);
                }
            }
			mediaDetails.downloadLinks = apiDetails.downloadLinks
			if (!mediaDetails.downloadLinks)
			{
				mediaDetails.downloadLinks = [];
			}
			mediaDetails.otherVersions = [];
			if (otherVersions) {
				for (let version of otherVersions)
				{
					try {
						version.id = version.url.split('&id=')[1].split('-')[0]
						mediaDetails.otherVersions.push(version)
					} catch (e) {
						// Skip
					}
				}
			}
			return mediaDetails;
		}		

		private dedupResults(results)
		{
			Logger.debug("ZtBot", "dedupResults", results)
			// if title is same, choose one with highest quality
			let dedupedResults = []
			let titles = {}
			for (let aResult of results)
			{
				if (titles[aResult.title] == null)
				{
					titles[aResult.title] = aResult
				}
				else
				{
					if (this.isNewQualityBetter(titles[aResult.title].quality, aResult.quality))
					{
						titles[aResult.title] = aResult
					}
				}
			}
			for (let key in titles)
			{
				dedupedResults.push(titles[key])
			}
			return dedupedResults
		}

		
		private isNewQualityBetter(oldQuality, newQuality)
		{
			let oldQualityIndex = this.getQualityIndex(oldQuality)
			let newQualityIndex = this.getQualityIndex(newQuality)
			return newQualityIndex > oldQualityIndex
		}

		private getQualityIndex(qualityStr)
		{
			let index = qualityOrder.indexOf(qualityStr)
			if (index == -1)
			{
				if (qualityStr.indexOf("720p") != -1)
				{
					index = qualityOrder.indexOf(Q_720_DEFAULT);
				}
				else if (qualityStr.indexOf("1080p") != -1)
				{
					index = qualityOrder.indexOf(Q_1080_DEFAULT);
				}
				else if (qualityStr.indexOf("4K") != -1)
				{
					index = qualityOrder.indexOf(Q_4K_DEFAULT);
				}
			}
			return index
		}


		protected async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

		private async callZtApi(url = '', params = {})
		{
			url += "?";
			for (let key in params)
			{
				url += key + "=" + encodeURIComponent(params[key]) + "&";
			}
			return this.callApi(this.ztApiUrl+url, null, "GET", "");
		}

        private async callApi(url = '', body = {}, method = 'POST', bearerToken = "") 
        {
            await this.sleep(277);
            let response = null;
            try {
                response = await fetch(url, {
                    "headers": {
                        "accept": "*/*",
                        "accept-language": "en-US,en;q=0.9",
                        "content-type": "application/json; charset=UTF-8",
                        "sec-ch-ua": "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\"",
                        "sec-ch-ua-mobile": "?0",
                        "sec-ch-ua-platform": "\"macOS\"",
                        "sec-fetch-dest": "empty",
                        "sec-fetch-mode": "cors",
                        "sec-fetch-site": "same-origin",
                        "x-requested-with": "XMLHttpRequest",
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Authorization": bearerToken == "" ? null : "Bearer "+bearerToken
                    },
                    "body": body == null ? null : JSON.stringify(body),
                    "method": method
                });
            }
            catch (e)
            {
                Logger.error("Error while calling API "+url, e);
                return {
                    status: 500,
                    error: e,
                    isJson: false
                }
            }
            

            let rawData:any = await response.text();
            if (response.status != 200 && response.status != 201)
            {
                return {
                    status: response.status,
                    error: response.statusText + " - " + rawData,
                    isJson: false
                }
            }
            let isJson = false
            try {
                rawData = JSON.parse(rawData);
                isJson = true;
            }
            catch (e) {
                // Not json
            }
			if (isJson && rawData.status == 400)
			{
				rawData.error = rawData.message
			}

			if (isJson && rawData.error)
			{
				if (rawData.stack)
				{
					Logger.error("Error while calling API "+url, rawData.error, rawData.stack);
					this.discordBot.sendMessage(`${rawData.stack.join("\n\n")}`, {
						color: "#FF0000",
						title: "Error returned by ZT API proxy",
						fields: [
							{
								name: "URL",
								value: url
							}
						]
					})
				}
				return {
					status: 500,
					error: rawData.error,
					isJson: false
				}
			}
            return {
                status: response.status,
                isJson: isJson,
                data: rawData
            }
        }

        
        discordBot:any;
        ztApiUrl:string;
    }
}

export default ZtBot
