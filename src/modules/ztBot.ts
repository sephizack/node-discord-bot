import Logger from './logger.js'
import Utils from '../discord/utils.js'
import { CronJob } from 'cron';


namespace ZtBot {
	const qualityOrder = ["DVDRIP", "HDRIP", "WEBRiP", "WEBRIP",
		"WEB-DL 720p", "WEBRIP 720p", "HDLIGHT 720p", "BLU-RAY 720p",
		"HDLIGHT 1080p", "WEB-DL 1080p", "BLU-RAY 1080p",
		"BDRIP", "BLURAY REMUX 4K", "WEB-DL 4K", "4K LIGHT"]
	const Q_720_DEFAULT = "WEB-DL 720p"
	const Q_1080_DEFAULT = "WEB-DL 1080p"
	const Q_4K_DEFAULT = "4K LIGHT"


	type MediaSearchResult = {
		id: string;
		type: string;
		title?: string;
		url?: string;
		image?: string;
		quality?: string;
		language?: string;
	}
	type DownloadLink = {
		dlname?: string;
		url?: string;
	}
	type MediaDetails = {
		id: string;
		type: string
		url?: string;
		image?: string;
		quality?: string;
		language?: string;
		isBackupFromSearchData?: boolean;

		name?: string;
		synopsis?: string;
		filesize?: string;
		origin?: string;
		duration?: string;
		directors?: string[];
		productionYear?: string;
		originalTitle?: string;
		review?: string;
		imdb_reviews?: string;
		trailerUrl?: string;
		imdbUrl?: string;
		actors?: string[];
		genres?: string[];
		downloadLinks?: DownloadLink[];
		otherVersions?: MediaSearchResult[];
	}

    export class ZtBot {
        public constructor(discordBot: any, configData:any) {
            this.discordBot = discordBot
			this.ztApiUrl = configData.ztApiUrl
			this.alldebridApiUrl = configData.alldebridApiUrl
			this.alldebridApiKey = configData.alldebridApiKey
			this.apikey_collectapi = configData.apikey_collectapi
			this.filmsUrl = configData.filmsUrl

            this.discordBot.sendMessage("Use buttons to interact", {
				title: "ZT Bot re-started",
				color: "#800080",
				fields: [],
				buttons: this.getHelpButtons()
			})

			this.startNewItemNotifierDeamon('films')
			this.startNewItemNotifierDeamon('series')
        }

		private async startNewItemNotifierDeamon(category: string) {
			let _alreadyNotified_ids = {}
			try {
				let results = await this.getSearchResults('_4k_', 15, category, false)
				for (let searchData of results)
				{
					_alreadyNotified_ids[searchData.id] = true
				}
				// Every 1h check for new items
				let job = new CronJob('15 */1 * * *', async () => {
					let results = await this.getSearchResults('_4k_', 15, category, false)
					for (let searchData of results)
					{
						if (_alreadyNotified_ids[searchData.id] == null)
						{
							_alreadyNotified_ids[searchData.id] = true
							let mediaDetails = await this.getMediaDetails(searchData)
							if (!mediaDetails)
							{
								Logger.error("ZtBot", "startNewItemNotifierDeamon", "Cannot retrieve details for media", searchData.id)
								continue;
							}
							let curYear = new Date().getFullYear()
							if (mediaDetails.productionYear && parseInt(mediaDetails.productionYear) < curYear - 1)
							{
								Logger.debug("ZtBot", "startNewItemNotifierDeamon", "Skipping item as productionYear is too old", mediaDetails.productionYear)
								continue;
							}
							let prefix = '';
							if (category == 'films') {
								prefix = '**@here Nouveau film en 4K disponible !**\n'
							}
							else if (category == 'series') {
								prefix = '**@here Nouvelle publication 4K de plateformes de streaming !**\n'
							}
							Logger.info(`Detected new item in ${category}`, mediaDetails.name)
							this.displayResultCard(mediaDetails ,prefix)
						}
					}
				}, null, true, 'Europe/Paris');
			}
			catch (e) {
				Logger.error("ZtBot", "startNewItemNotifierDeamon", e)
			}
		}

		private getDebrideurButton() {
			return {
				label: "Debrider un lien",
				emoji: "🔓",
				options: {
					inputs: [
						
						{id: "link", label: "Link to debrid", placeholder: "(1fichier, uptobox, dl-protect, ...)"},
					],
					announcement:false,
					executeOnlyOnce: false
				},
				callback: async (inputs) => {
					return await this.handleDebridLink(inputs['link'])
				}
			}
		}

		private getHelpButtons() {
			let buildSearchButton = (searchText: string, searchType:string) => {
				return {
					label: `Search ${searchText}`,
					emoji: "🔍",
					options: {
						inputs: [
							{id: "search", label: "Search", placeholder: "Search text"},
							{id: "nb_result", label: "Amount of results", value: "6"},
						],
						announcement:false,
						executeOnlyOnce: false
					},
					callback: async (inputs) => {
						await this.handleMediaSearchRequest(inputs['search'], inputs['nb_result'], searchType)
					}
				}
			}
			return [
				{
					label: "Sorties Films 4K",
					emoji: "🎥",
					options: {
						announcement:false,
						executeOnlyOnce: false
					},
					callback: async (inputs) => {
						await this.handleMediaSearchRequest('_4k_', 7, 'films')
					}
				},
				{
					label: "Films Populaires",
					emoji: "🍿",
					options: {
						announcement:false,
						executeOnlyOnce: false
					},
					callback: async (inputs) => {
						await this.handleMediaSearchRequest('_exclus_', 10, 'films')
					}
				},
				{
					label: "Sorties Series 4K",
					emoji: "🎬",
					options: {
						
						announcement:false,
						executeOnlyOnce: false
					},
					callback: async (inputs) => {
						await this.handleMediaSearchRequest('_4k_', 5, 'series')
					}
				},
				buildSearchButton('Films', 'films'),
				buildSearchButton('Series', 'series'),
				buildSearchButton('Mangas', 'mangas'),
				this.getDebrideurButton(),
				{
					label: "Films disponibles",
					emoji: "📂",
					url: this.filmsUrl ? this.filmsUrl : ""
				}
				// {
				// 	label: "Help",
				// 	emoji: "❔",
				// 	options: {
				// 		announcement:false,
				// 		executeOnlyOnce: false
				// 	},
				// 	callback: () => {
				// 		this.displayHelp()
				// 	}
				// }
			]
		}
		
		private async handleDebridLink(link: string) {
			if (link.includes("dl-protect.link"))
			{
				let reply = await this.callAllDebrid(`/link/redirector`, {
					link: link
				});
				if (reply.status != 200 || reply?.isJson == false)
				{
					this.discordBot.sendMessage(`AllDebrid API failed (status: ${reply?.status}, message: ${reply?.error})`, {
						color: "#FF0000"
					})
					return
				}
				if (reply.data.status == "success" && reply.data.data.links && reply.data.data.links.length > 0)
				{
					link = reply.data.data.links[0]
					Logger.info("ZtBot", "handleDebridLink", "DL Protect debrided", link)
				}
				else
				{
					this.discordBot.sendMessage(`AllDebrid API failed (status: ${reply?.status}, message: ${reply.data})`, {
						color: "#FF0000"
					})
					return
				}
			}
			let reply = await this.callAllDebrid(`/link/unlock`, {
				link: link
			});
			if (reply.status != 200 || reply?.isJson == false)
			{
				this.discordBot.sendMessage(`AllDebrid API failed (status: ${reply?.status}, message: ${reply?.error})`, {
					color: "#FF0000"
				})
				return
			}
			Logger.info("ZtBot", "handleDebridLink", "Debrided", reply.data.data)
			this.discordBot.sendMessage(`Here is your debrided link 🍿`, {
				color: "#00FF00",
				fields: [
					{
						name: "Debrided Link",
						value: reply.data.data.link
					},
					{
						name: "Host",
						value: reply.data.data.host
					},
					{
						name: "Filename",
						value: reply.data.data.filename
					},
					{
						name: "Size",
						value: Math.floor((reply.data.data.filesize / 1024 / 1024 /1024)*100)/100 + " Go"
					}
				]
			})
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
		
		private async getSearchResults(searchFreetext: string, nb_results_max: number, category: string, notifyProgress: boolean = true) : Promise<MediaSearchResult[]> {
			let reply = await this.callZtApi('/api/search', {
				category: category,
				query: searchFreetext
			});
			if (reply.status != 200 || reply?.isJson == false)
			{
				if (notifyProgress)
				{
					this.discordBot.sendMessage(`ZT API failed (status: ${reply?.status}, message: ${reply?.error})`, {
						color: "#FF0000"
					})
				}
				return []
			}
			else if (reply.data.length == 0)
			{
				if (notifyProgress)
				{
					this.discordBot.sendMessage(`Aucun résultat trouvé pour ${searchFreetext}`, {
						// color: "#0000"
					})
				}
				return []
			}
			else
			{
				let results = this.dedupResults(reply.data)
				if (results.length > nb_results_max)
				{
					if (notifyProgress)
					{
						let truncTxt = nb_results_max > 1 ? `(seulement les ${nb_results_max} premiers seront affiché)` : "(selement le premier sera affiché)"
						this.discordBot.sendMessage(`${results.length} resultats ${truncTxt}`, {
							color: "#00ff00"
						})
					}
				}

				let aSearchResults : MediaSearchResult[] = []
				let aSearchResultsNotInTitle : MediaSearchResult[] = []
				for (let aSearchResult of results)
				{
					let searchData : MediaSearchResult = {
						id: aSearchResult.id,
						type: this.convertCategoryToType(category),
						title: aSearchResult.title,
						url: aSearchResult.url,
						image: aSearchResult.image,
						quality: aSearchResult.quality,
						language: aSearchResult.language
					}
					if (this.filterResult(searchData, searchFreetext))
					{
						aSearchResults.push(searchData)
					}
					else
					{
						aSearchResultsNotInTitle.push(searchData)
					}
				}

				if (aSearchResults.length < nb_results_max)
				{
					for (let aSearchResult of aSearchResultsNotInTitle)
					{
						aSearchResults.push(aSearchResult)
						if (aSearchResults.length >= nb_results_max)
						{
							break;
						}
					}
				}
				return aSearchResults.slice(0, nb_results_max)
			}
		}

		private convertCategoryToType(category: string): string {
			// remove last char if it's an 's'
			return category.slice(-1) == 's' ? category.slice(0, -1) : category
		}
		
		private filterResult(result: MediaSearchResult, searchFreetext: string): boolean {
			// check that each word in searchFreetext is in the title
			let searchWords = searchFreetext.split(' ')
			for (let aWord of searchWords)
			{
				if (result.title.toLowerCase().indexOf(aWord.toLowerCase()) == -1)
				{
					return false;
				}
			}
			return true;
		}

		private mediaSearchToDetails(searchData: MediaSearchResult) : MediaDetails
		{
			let mediaDetails : MediaDetails = {
				id: searchData.id,
				type: searchData.type,
				url: searchData.url,
				image: searchData.image,
				quality: searchData.quality,
				name: `[Incomplete result] ${searchData.title}`,
				isBackupFromSearchData: true
			}
			return mediaDetails;
		}

		private async getMediaDetails(searchData: MediaSearchResult) : Promise<MediaDetails | null>
		{
			try {
				let resultDetails : MediaDetails = await this.retrieveDetailsForSearch(searchData)
				if (!resultDetails)
				{
					return this.mediaSearchToDetails(searchData);
				}
				let betterVersion : MediaSearchResult = this.findBetterVersionId(resultDetails)
				if (betterVersion && betterVersion.id != searchData.id)
				{
					resultDetails = await this.retrieveDetailsForSearch(betterVersion)
				}
				return resultDetails
			}
			catch (e) {
				Logger.error("ZtBot", "getMediaDetails", e)
			}
			return null
		}

		private async handleMediaSearchRequest(searchFreetext: string, nb_results_max: number, category: string) {
			try {
				Logger.info("ZtBot", "handleMediaSearchRequest", searchFreetext, nb_results_max, category)
				let results = await this.getSearchResults(searchFreetext, nb_results_max, category)
				for (let searchData of results)
				{
					// Retrieve full detials & display
					this.displayResultCard(await this.getMediaDetails(searchData))
				}
			}
			catch (e) {
				Logger.error("ZtBot", "handleMediaSearchRequest", e)
				this.discordBot.sendMessage(`Error while searching for ${searchFreetext} in ${category}`, {
					color: "#FF0000"
				})
			}
			await this.sleep(1000)
			this.discordBot.sendMessage("Use buttons to interact", {
				title: "Pour d'autres recherches utilisez les boutons ci-dessous",
				color: "#800080",
				fields: [],
				buttons: this.getHelpButtons()
			})
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

		private async displayResultCard(media: MediaDetails, descriptionPrefix: string = "") {
			if (!media)
			{
				Logger.error("ZtBot", "displayResultCard", "Cannot display null media")
				return
			}

			media.imdb_reviews = `Allocine: ${media.review} | [View on IMDb](https://www.imdb.com/find/?q=${encodeURIComponent(media.name)})`

			await this.retrieveAdvancedReviews(media)
			
			if (media.isBackupFromSearchData)
			{
				let mediaSearch : MediaSearchResult = {
					id: media.id,
					type: media.type,
					title: media.name,
					url: media.url,
					image: media.image,
					quality: media.quality,
				}
				this.displayResultCardWithSearchData(mediaSearch)
				return
			}
			let resultsFields = []
			if (media.imdb_reviews) {
				resultsFields.push({
					name: `IMDb`,
					value: `${media.imdb_reviews}\n[Open IMDb Page](${media.imdbUrl})`
				});
			}
			resultsFields = resultsFields.concat([
				{
					name: `Genres`,
					value: `${media.genres ? media.genres.join(" | ") : "N/A"}`
				},
				{
					name: `Réalisateurs`,
					value: `${media.directors ? media.directors.join(" | ") : "Unknown"}`
				},
				{
					name: `Acteurs`,
					value: `${media.actors ? media.actors.join(" | ") : "Unknown"}`
				},
				{
					name: `Details`,
					value: `${media.duration} | ${media.quality} | ${media.language} | ${media.origin} | Size: ${media.filesize}`
				}
			]);

			let buttons = []
			if (media.url) {
                buttons.push({
                    label: "ZT Page",
                    emoji: "🔗",
                    url: media.url
                })
            }

			if (media.imdbUrl) {
				buttons.push({
					label: "IMDb page",
					emoji: "🎬",
					url: media.imdbUrl
				})
			}

			buttons.push({
				label: "Trailer Youtube",
				emoji: "▶️",
				url: `https://www.youtube.com/results?search_query=bande+annonce+fr+${encodeURIComponent(media.name)}`
			})

			buttons.push(this.getDebrideurButton());

			let bestLink = null
			if (media.downloadLinks) {
				for (let aLink of media.downloadLinks) {
					if (!aLink.url) {
						continue;
					}
					if (bestLink == null || aLink.dlname == "1fichier")
					{
						bestLink = aLink
					}
					buttons.push({
						label: aLink.dlname,
						emoji: "⬇️",
						url: aLink.url
					});
				}
			}

			
			if (bestLink != null)
			{
				buttons.push({
					label: `Debrider ${bestLink.dlname}`,
					emoji: "🔓",
					options: {
						announcement:false,
						executeOnlyOnce: true
					},
					callback: async (inputs) => {
						return await this.handleDebridLink(bestLink.url)
					}
				})
			}

			let reviewStars = ""
			if (media.imdb_reviews) {
				let nb_stars = parseFloat(media.review.split('/')[0])/2
				while (nb_stars >= 1)
				{
					reviewStars += "✭"
					nb_stars--
				}
				if (nb_stars > 0)
				{
					reviewStars += "✯"
				}
				// then empty stars
				while (reviewStars.length < 5)
				{
					reviewStars += "✩"
				}
			}
			this.discordBot.sendMessage(descriptionPrefix + media.synopsis, {
				title: `${reviewStars} [${media.productionYear}] ${media.name}`,
				fields: resultsFields,
				color: "#00FF00",
				image: media.image,
				buttons: buttons
			})
		}

		private async retrieveAdvancedReviews(media: MediaDetails)
		{
			let api_auth = "apikey "+this.apikey_collectapi
			if (!media.name)
			{
				return null
			}
			let reply = await this.callApi(`https://www.imdb.com/find/?q=${encodeURIComponent(media.name)}`, null, "GET", "");
			if (reply.status != 200)
			{
				Logger.error("ZtBot", "retrieveAdvancedReviews", "Cannot find imdb id for "+media.name, reply)
				return null
			}
			let links = reply.data.split('href="/title/')
			if (links.length == 0)
			{
				Logger.error("ZtBot", "retrieveAdvancedReviews", "Cannot find imdb id for "+media.name)
				return null
			}

			let bestImdbId = links[1].split('/')[0]
			Logger.info("ZtBot", "retrieveAdvancedReviews", "Found imdbId for "+media.name, bestImdbId)

			let reply_for_id = await this.callApi(`https://api.collectapi.com/imdb/imdbSearchById?movieId=${bestImdbId}`, null, "GET", api_auth);
			if (reply_for_id.status != 200 || reply_for_id?.isJson == false || reply_for_id.data.success == false)
			{
				Logger.error("ZtBot", "retrieveAdvancedReviews", "Cannot retrieve advanced reviews", media.name)
				return null
			}
			let imdbDetails = reply_for_id.data.result;
			if (!imdbDetails)
			{
				Logger.error("ZtBot", "retrieveAdvancedReviews", "Cannot find details for imdbId", bestImdbId)
				return null
			}
			
			media.name = imdbDetails.Title
			media.review = imdbDetails.imdbRating
			media.imdb_reviews = `**${imdbDetails.imdbRating}/10** (${imdbDetails.imdbVotes} votes)`
			media.imdbUrl = `https://www.imdb.com/title/${bestImdbId}`
			media.image = imdbDetails.Poster
			Logger.info("ZtBot", "retrieveAdvancedReviews", "Found advanced reviews for "+media.name, media.imdb_reviews)
		}

		private findBetterVersionId(resultDetails: MediaDetails) : MediaSearchResult {
			let foundBetterVersion = false
			let bestVersion : MediaSearchResult = {
				id: resultDetails.id,
				type: resultDetails.type,
				title: resultDetails.name,
				url: resultDetails.url,
				image: resultDetails.image,
				quality: resultDetails.quality,
				language: resultDetails.language
			} 
			for (let aVersion of resultDetails.otherVersions)
			{
				// console.log("Checking quality. Current:", bestVersion.quality, "New:", aVersion.quality)
				if (this.isNewQualityBetter(bestVersion.quality, aVersion.quality))
				{
					// console.log("Found better version", aVersion.quality)
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
				type: search.type,
				url: search.url,
				image: search.image,
				quality: search.quality,
				language: search.language
			}

			let apiData = await this.callZtApi('/api/getMovieDetails', {
				id: search.id,
				type: search.type
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
            // console.log("API Details", apiDetails);
            if (!apiDetails) {
                console.error("No details found for ID", search.id, apiData);
                this.displayResultCardWithSearchData(search);
                return null;
            }

			mediaDetails.name = apiDetails.name
			mediaDetails.synopsis = apiDetails.synopsis
			mediaDetails.filesize = apiDetails.filesize
			mediaDetails.origin = apiDetails.origin
			mediaDetails.duration = apiDetails.duration
			mediaDetails.productionYear = apiDetails.productionYear
			mediaDetails.originalTitle = apiDetails.originalTitle
			mediaDetails.review = apiDetails.review
			mediaDetails.trailerUrl = apiDetails.trailer
			mediaDetails.directors = []
            if (apiDetails.director) {
                for (let actor of apiDetails.director) {
                    mediaDetails.directors.push(actor);
                }
            }
			mediaDetails.actors = []
            if (apiDetails.actors) {
                for (let actor of apiDetails.actors) {
                    mediaDetails.actors.push(actor);
                }
            }
            mediaDetails.genres = []
            if (apiDetails.genres) {
                for (let genre of apiDetails.genres) {
                    mediaDetails.genres.push(genre);
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
			// Logger.debug("ZtBot", "dedupResults", results)
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

		private async callAllDebrid(url = '', params = {})
		{
			url += "?";
			params['agent'] = 'synology'
			params['version'] = '4.1'
			params['apikey'] = this.alldebridApiKey
			for (let key in params)
			{
				url += key + "=" + encodeURIComponent(params[key]) + "&";
			}
			return this.callApi(this.alldebridApiUrl+url, null, "GET", "");
		}

        private async callApi(url = '', body = {}, method = 'POST', auth_header = "") 
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
                        "Authorization": auth_header == "" ? null : auth_header
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
					// Logger.error("Error while calling API "+url, rawData.error, rawData.stack);
					if (rawData.stack.length > 0 && rawData.stack[0].includes('DNS might have changed recently'))
					{
						this.discordBot.sendMessage(`${rawData.stack[0]}`, {
							color: "#00a2ff",
							title: "ZT semble avoir déménagé 🛠️",
							fields: [
								{
									name: "Called URL",
									value: url
								}
							]
						})
					}
					else 
					{
						Logger.error("Error while calling API "+url, rawData.error, rawData.stack);
						this.discordBot.sendMessage(`${rawData.stack.join("\n\n")}`, {
							color: "#FF0000",
							title: "Error returned by ZT API proxy",
							fields: [
								{
									name: "Called URL",
									value: url
								}
							]
						})
					}
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
        alldebridApiUrl:string;
        alldebridApiKey:string;
        apikey_collectapi:string;
        filmsUrl:string;
    }
}

export default ZtBot
