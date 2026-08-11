/**
 * Election Survey API — Deno Deploy / Playground version
 * -------------------------------------------------------
 * Same Neon DB as your Node app. Host the API on Deno so the
 * Android app does not need your PC on the same Wi‑Fi.
 *
 * Playground steps:
 * 1. Open https://dash.deno.com → New Playground (or New Project)
 * 2. Paste this file as main.ts (or upload the deno-deploy folder)
 * 3. Settings → Environment Variables:
 *      DATABASE_URL = your Neon connection string (sslmode=require)
 * 4. Save / Deploy → you get a URL like:
 *      https://election-survey-xxxx.deno.dev
 * 5. In the mobile app: API server settings → that URL
 *    (no trailing slash)
 *
 * Local test:
 *   export DATABASE_URL='postgresql://...'
 *   deno run -A --env main.ts
 */

import { neon } from "npm:@neondatabase/serverless@0.10.4";

// ── Geo aliases (inlined so the Deno Playground deploys a single file) ──
const GEO_ALIASES = {"telugu":{"ఆదిలాబాద్":"Adilabad","భద్రాద్రి కొత్తగూడెం":"Bhadradri Kothagudem","భద్రాచలం":"Bhadradri Kothagudem","హనుమకొండ":"Hanumakonda","హన్మకొండ":"Hanumakonda","హైదరాబాద్":"Hyderabad","జగిత్యాల":"Jagitial","జోగులాంబ గద్వాల్":"Jogulamba Gadwal","కామారెడ్డి":"Kamareddy","కరీంనగర్":"Karimnagar","ఖమ్మం":"Khammam","కొమరంభీమ్ ఆసిఫాబాద్":"Komarambheem Asifabad","కొమరంభీం":"Komarambheem Asifabad","కొమరంభీం ఆసిఫాబాద్":"Komarambheem Asifabad","జనగామ":"Jangaon","జనగాం":"Jangaon","మహబూబాబాద్":"Mahabubabad","మహబూబాబాదు":"Mahabubabad","మహబూబ్నగర్":"Mahabubnagar","మహబూబ్ నగర్":"Mahabubnagar","మంచిర్యాల":"Mancherial","మెదక్":"Medak","మేడ్చల్ మల్కాజ్గిరి":"Medchal Malkajgiri","మేడ్చెల్ మల్కాజ్గిరి":"Medchal Malkajgiri","మేడ్చల్-మల్కాజ్గిరి":"Medchal Malkajgiri","ములుగు":"Mulugu","నాగర్కర్నూల్":"Nagarkurnool","నాగర్ కర్నూల్":"Nagarkurnool","నల్గొండ":"Nalgonda","నిర్మల్":"Nirmal","నిజామాబాద్":"Nizamabad","పెద్దపల్లి":"Peddapalli","రాజన్న సిరిసిల్ల":"Rajanna Sircilla","రంగారెడ్డి":"Rangareddy","సంగారెడ్డి":"Sangareddy","సిద్ధిపేట్":"Siddipet","సూర్యాపేట":"Suryapet","వికారాబాద్":"Vikarabad","వికారాబాదు":"Vikarabad","వనపర్తి":"Wanaparthy","వరంగల్":"Warangal","వరంగల్ (అర్బన్)":"Hanumakonda","వరంగల్ (రూరల్)":"Warangal","యాదాద్రి భువనగిరి":"Yadadri Bhuvanagiri","యాదాద్రి":"Yadadri Bhuvanagiri","భువనగిరి":"Yadadri Bhuvanagiri","జయశంకర్ భూపాలపల్లి":"Jayashankar Bhupalapally","నారాయణపేట":"Narayanpet","సిరిసిల్ల":"Rajanna Sircilla","అసిఫాబాద్":"Komarambheem Asifabad","ఆసిఫాబాద్":"Komarambheem Asifabad","కొత్తగూడెం":"Bhadradri Kothagudem","మల్కాజ్గిరి":"Medchal Malkajgiri","మల్కాజ్‌గిరి":"Medchal Malkajgiri","మేడ్చల్":"Medchal Malkajgiri","గద్వాల్":"Jogulamba Gadwal","జోగులాంబ గద్వాల":"Jogulamba Gadwal","భూపాలపల్లి":"Jayashankar Bhupalapally","సిద్దిపేట":"Siddipet"},"districts":{"adilabad":"Adilabad","bhadradri kothagudem":"Bhadradri Kothagudem","bhadradri":"Bhadradri Kothagudem","kothagudem":"Bhadradri Kothagudem","bhadradri kothagudam":"Bhadradri Kothagudem","bhadradri kothgudem":"Bhadradri Kothagudem","hyderabad":"Hyderabad","hyd":"Hyderabad","hyderabad district":"Hyderabad","jagitial":"Jagitial","jagtial":"Jagitial","jagityal":"Jagitial","jagtiyal":"Jagitial","jagital":"Jagitial","jagityala":"Jagitial","jangaon":"Jangaon","jangaun":"Jangaon","jayashankar bhupalapally":"Jayashankar Bhupalapally","jayashankar":"Jayashankar Bhupalapally","jayashankar bhupalpally":"Jayashankar Bhupalapally","jayashankar bhoopalpally":"Jayashankar Bhupalapally","jayshankar":"Jayashankar Bhupalapally","bhupalpally":"Jayashankar Bhupalapally","bhupalapally":"Jayashankar Bhupalapally","bhupalpalle":"Jayashankar Bhupalapally","jaya shankar":"Jayashankar Bhupalapally","jogulamba gadwal":"Jogulamba Gadwal","jogulamba":"Jogulamba Gadwal","gadwal":"Jogulamba Gadwal","kamareddy":"Kamareddy","kamareddi":"Kamareddy","kamaredi":"Kamareddy","karimnagar":"Karimnagar","karim nagar":"Karimnagar","khammam":"Khammam","komarambheem asifabad":"Komarambheem Asifabad","komarambheem":"Komarambheem Asifabad","komaram bheem":"Komarambheem Asifabad","komaram bheem asifabad":"Komarambheem Asifabad","kumurambheem":"Komarambheem Asifabad","kumuram bheem":"Komarambheem Asifabad","kumrambheem":"Komarambheem Asifabad","kumurambheem asifabad":"Komarambheem Asifabad","asifabad":"Komarambheem Asifabad","mahabubabad":"Mahabubabad","mahbubabad":"Mahabubabad","mahaboobabad":"Mahabubabad","mahabubnagar":"Mahabubnagar","mahbubnagar":"Mahabubnagar","mahaboobnagar":"Mahabubnagar","mancherial":"Mancherial","manchirial":"Mancherial","manchariyal":"Mancherial","medak":"Medak","medchal malkajgiri":"Medchal Malkajgiri","medchal":"Medchal Malkajgiri","malkajgiri":"Medchal Malkajgiri","medchal malkajgiri district":"Medchal Malkajgiri","mulugu":"Mulugu","mulug":"Mulugu","nagarkurnool":"Nagarkurnool","nagar kurnool":"Nagarkurnool","nagarkurnul":"Nagarkurnool","nalgonda":"Nalgonda","nalgunda":"Nalgonda","narayanpet":"Narayanpet","narayanapet":"Narayanpet","narayampet":"Narayanpet","nirmal":"Nirmal","nizamabad":"Nizamabad","peddapalli":"Peddapalli","peddapalle":"Peddapalli","peddapally":"Peddapalli","rajanna sircilla":"Rajanna Sircilla","sircilla":"Rajanna Sircilla","siricilla":"Rajanna Sircilla","rajanna siricilla":"Rajanna Sircilla","rangareddy":"Rangareddy","ranga reddy":"Rangareddy","rangareddi":"Rangareddy","ranga reddi":"Rangareddy","sangareddy":"Sangareddy","sangareddi":"Sangareddy","sanga reddy":"Sangareddy","siddipet":"Siddipet","siddhipet":"Siddipet","suryapet":"Suryapet","vikarabad":"Vikarabad","vicarabad":"Vikarabad","wanaparthy":"Wanaparthy","wanaparthi":"Wanaparthy","warangal":"Warangal","warangal rural":"Warangal","hanumakonda":"Hanumakonda","hanamkonda":"Hanumakonda","warangal urban":"Hanumakonda","warangal city":"Hanumakonda","hanmakonda":"Hanumakonda","yadadri bhuvanagiri":"Yadadri Bhuvanagiri","yadadri":"Yadadri Bhuvanagiri","yadadri bhongir":"Yadadri Bhuvanagiri","yadadri bhongiri":"Yadadri Bhuvanagiri","bhuvanagiri":"Yadadri Bhuvanagiri"},"districtNames":["Adilabad","Bhadradri Kothagudem","Hanumakonda","Hyderabad","Jagitial","Jangaon","Jayashankar Bhupalapally","Jogulamba Gadwal","Kamareddy","Karimnagar","Khammam","Komarambheem Asifabad","Mahabubabad","Mahabubnagar","Mancherial","Medak","Medchal Malkajgiri","Mulugu","Nagarkurnool","Nalgonda","Narayanpet","Nirmal","Nizamabad","Peddapalli","Rajanna Sircilla","Rangareddy","Sangareddy","Siddipet","Suryapet","Vikarabad","Wanaparthy","Warangal","Yadadri Bhuvanagiri"],"acs":{"sirpur":"Sirpur","siripuram":"Sirpur","chennur":"Chennur","chennuru":"Chennur","chenur":"Chennur","bellampalle":"Bellampalle","bellampalli":"Bellampalle","bellampally":"Bellampalle","bellampalle sc":"Bellampalle","mancherial":"Mancherial","manchirial":"Mancherial","asifabad":"Asifabad","khanapur":"Khanapur","adilabad":"Adilabad","boath":"Boath","both":"Boath","nirmal":"Nirmal","mudhole":"Mudhole","mudhol":"Mudhole","armur":"Armur","armoor":"Armur","bodhan":"Bodhan","jukkal":"Jukkal","banswada":"Banswada","banswara":"Banswada","bansuvada":"Banswada","yellareddy":"Yellareddy","yellareddi":"Yellareddy","kamareddy":"Kamareddy","kamareddi":"Kamareddy","nizamabad urban":"Nizamabad Urban","nizamabad city":"Nizamabad Urban","nizamabad u":"Nizamabad Urban","nizamabad rural":"Nizamabad Rural","nizamabad r":"Nizamabad Rural","balkonda":"Balkonda","korutla":"Korutla","koratla":"Korutla","jagtial":"Jagtial","jagitial":"Jagtial","jagityal":"Jagtial","jagtiyal":"Jagtial","dharmapuri":"Dharmapuri","ramagundam":"Ramagundam","manthani":"Manthani","peddapalli":"Peddapalli","peddapalle":"Peddapalli","peddapally":"Peddapalli","karimnagar":"Karimnagar","karim nagar":"Karimnagar","choppadandi":"Choppadandi","chopardandi":"Choppadandi","choppadandhi":"Choppadandi","vemulawada":"Vemulawada","vemulavada":"Vemulawada","sircilla":"Sircilla","siricilla":"Sircilla","manakondur":"Manakondur","huzurabad":"Huzurabad","husnabad":"Husnabad","siddipet":"Siddipet","siddhipet":"Siddipet","medak":"Medak","narayankhed":"Narayankhed","andole":"Andole","narsapur":"Narsapur","zahirabad":"Zahirabad","zaheerabad":"Zahirabad","zaherabad":"Zahirabad","sangareddy":"Sangareddy","sangareddi":"Sangareddy","patancheru":"Patancheru","dubbak":"Dubbak","dubbaka":"Dubbak","gajwel":"Gajwel","quthbullapur":"Quthbullapur","qutbullapur":"Quthbullapur","kutbullapur":"Quthbullapur","quthbullapally":"Quthbullapur","quathbullapur":"Quthbullapur","kukatpally":"Kukatpally","kukatpalle":"Kukatpally","kukatpalli":"Kukatpally","uppal":"Uppal","malkajgiri":"Malkajgiri","malkajgiri urban":"Malkajgiri","malkajgiri east":"Malkajgiri","malkajgiri west":"Malkajgiri","secunderabad cantonment":"Secunderabad Cantonment","secunderabad cantt":"Secunderabad Cantonment","secunderabad cant":"Secunderabad Cantonment","sc cantonment":"Secunderabad Cantonment","secunderabad cantt sc":"Secunderabad Cantonment","musheerabad":"Musheerabad","musherabad":"Musheerabad","malakpet":"Malakpet","amberpet":"Amberpet","khairatabad":"Khairatabad","khairtabad":"Khairatabad","jubilee hills":"Jubilee Hills","sanathnagar":"Sanathnagar","sanath nagar":"Sanathnagar","nampally":"Nampally","karwan":"Karwan","goshamahal":"Goshamahal","gosha mahal":"Goshamahal","charminar":"Charminar","chandrayangutta":"Chandrayangutta","chandragutta":"Chandrayangutta","yakutpura":"Yakutpura","yaqutpura":"Yakutpura","bahadurpura":"Bahadurpura","maheshwaram":"Maheshwaram","maheswaram":"Maheshwaram","rajendranagar":"Rajendranagar","rajendra nagar":"Rajendranagar","serilingampally":"Serilingampally","serilingampalli":"Serilingampally","seri lingampally":"Serilingampally","chevella":"Chevella","pargi":"Pargi","parigi":"Pargi","vikarabad":"Vikarabad","vicarabad":"Vikarabad","tandur":"Tandur","kodangal":"Kodangal","narayanpet":"Narayanpet","narayanapet":"Narayanpet","mahbubnagar":"Mahbubnagar","mahabubnagar":"Mahbubnagar","mahaboobnagar":"Mahbubnagar","jadcherla":"Jadcherla","devarkadra":"Devarkadra","makthal":"Makthal","wanaparthy":"Wanaparthy","wanaparthi":"Wanaparthy","gadwal":"Gadwal","alampur":"Alampur","nagarkurnool":"Nagarkurnool","nagar kurnool":"Nagarkurnool","achampet":"Achampet","kalwakurthy":"Kalwakurthy","kalwakurthi":"Kalwakurthy","shadnagar":"Shadnagar","shad nagar":"Shadnagar","kollapur":"Kollapur","devarakonda":"Devarakonda","devarkonda":"Devarakonda","nagarjuna sagar":"Nagarjuna Sagar","nagarjunasagar":"Nagarjuna Sagar","miryalaguda":"Miryalaguda","miryala guda":"Miryalaguda","miryalguda":"Miryalaguda","huzurnagar":"Huzurnagar","huzur nagar":"Huzurnagar","kodad":"Kodad","suryapet":"Suryapet","nalgonda":"Nalgonda","munugode":"Munugode","bhongir":"Bhongir","bhongiri":"Bhongir","bhuvanagiri":"Bhongir","nakrekal":"Nakrekal","thungathurthi":"Thungathurthi","thungaturthi":"Thungathurthi","thungaturthy":"Thungathurthi","thungathurthy":"Thungathurthi","alair":"Alair","jangaon":"Jangaon","ghanpur station":"Ghanpur (Station)","ghanpur stn":"Ghanpur (Station)","ghanpur":"Ghanpur (Station)","palakurthi":"Palakurthi","palakurthy":"Palakurthi","dornakal":"Dornakal","mahabubabad":"Mahabubabad","mahbubabad":"Mahabubabad","mahaboobabad":"Mahabubabad","narsampet":"Narsampet","parkal":"Parkal","warangal west":"Warangal West","warangal w":"Warangal West","warangal east":"Warangal East","warangal e":"Warangal East","wardhannapet":"Wardhannapet","waradhanapet":"Wardhannapet","wardannapet":"Wardhannapet","bhupalpalle":"Bhupalpalle","bhupalpally":"Bhupalpalle","bhupalapally":"Bhupalpalle","bhupalpalli":"Bhupalpalle","mulug":"Mulug","mulugu":"Mulug","pinapaka":"Pinapaka","yellandu":"Yellandu","khammam":"Khammam","palair":"Palair","madhira":"Madhira","wyra":"Wyra","sathupalli":"Sathupalli","sathupalle":"Sathupalli","kothagudem":"Kothagudem","aswaraopeta":"Aswaraopeta","aswaraopet":"Aswaraopeta","bhadrachalam":"Bhadrachalam","secunderabad":"Secunderabad","lal bahadur nagar":"Lal Bahadur Nagar","lb nagar":"Lal Bahadur Nagar","lbnagar":"Lal Bahadur Nagar","ibrahimpatnam":"Ibrahimpatnam","brahimpatnam":"Ibrahimpatnam","ibrahimpatan":"Ibrahimpatnam","medchal":"Medchal","sirpur gen":"Sirpur","sirpur sc":"Sirpur","sirpur st":"Sirpur","chennur gen":"Chennur","chennur sc":"Chennur","chennur st":"Chennur","bellampalle gen":"Bellampalle","bellampalle st":"Bellampalle","mancherial gen":"Mancherial","mancherial sc":"Mancherial","mancherial st":"Mancherial","asifabad gen":"Asifabad","asifabad sc":"Asifabad","asifabad st":"Asifabad","khanapur gen":"Khanapur","khanapur sc":"Khanapur","khanapur st":"Khanapur","adilabad gen":"Adilabad","adilabad sc":"Adilabad","adilabad st":"Adilabad","boath gen":"Boath","boath sc":"Boath","boath st":"Boath","nirmal gen":"Nirmal","nirmal sc":"Nirmal","nirmal st":"Nirmal","mudhole gen":"Mudhole","mudhole sc":"Mudhole","mudhole st":"Mudhole","armur gen":"Armur","armur sc":"Armur","armur st":"Armur","bodhan gen":"Bodhan","bodhan sc":"Bodhan","bodhan st":"Bodhan","jukkal gen":"Jukkal","jukkal sc":"Jukkal","jukkal st":"Jukkal","banswada gen":"Banswada","banswada sc":"Banswada","banswada st":"Banswada","yellareddy gen":"Yellareddy","yellareddy sc":"Yellareddy","yellareddy st":"Yellareddy","kamareddy gen":"Kamareddy","kamareddy sc":"Kamareddy","kamareddy st":"Kamareddy","nizamabad urban gen":"Nizamabad Urban","nizamabad urban sc":"Nizamabad Urban","nizamabad urban st":"Nizamabad Urban","nizamabad rural gen":"Nizamabad Rural","nizamabad rural sc":"Nizamabad Rural","nizamabad rural st":"Nizamabad Rural","balkonda gen":"Balkonda","balkonda sc":"Balkonda","balkonda st":"Balkonda","korutla gen":"Korutla","korutla sc":"Korutla","korutla st":"Korutla","jagtial gen":"Jagtial","jagtial sc":"Jagtial","jagtial st":"Jagtial","dharmapuri gen":"Dharmapuri","dharmapuri sc":"Dharmapuri","dharmapuri st":"Dharmapuri","ramagundam gen":"Ramagundam","ramagundam sc":"Ramagundam","ramagundam st":"Ramagundam","manthani gen":"Manthani","manthani sc":"Manthani","manthani st":"Manthani","peddapalli gen":"Peddapalli","peddapalli sc":"Peddapalli","peddapalli st":"Peddapalli","karimnagar gen":"Karimnagar","karimnagar sc":"Karimnagar","karimnagar st":"Karimnagar","choppadandi gen":"Choppadandi","choppadandi sc":"Choppadandi","choppadandi st":"Choppadandi","vemulawada gen":"Vemulawada","vemulawada sc":"Vemulawada","vemulawada st":"Vemulawada","sircilla gen":"Sircilla","sircilla sc":"Sircilla","sircilla st":"Sircilla","manakondur gen":"Manakondur","manakondur sc":"Manakondur","manakondur st":"Manakondur","huzurabad gen":"Huzurabad","huzurabad sc":"Huzurabad","huzurabad st":"Huzurabad","husnabad gen":"Husnabad","husnabad sc":"Husnabad","husnabad st":"Husnabad","siddipet gen":"Siddipet","siddipet sc":"Siddipet","siddipet st":"Siddipet","medak gen":"Medak","medak sc":"Medak","medak st":"Medak","narayankhed gen":"Narayankhed","narayankhed sc":"Narayankhed","narayankhed st":"Narayankhed","andole gen":"Andole","andole sc":"Andole","andole st":"Andole","narsapur gen":"Narsapur","narsapur sc":"Narsapur","narsapur st":"Narsapur","zahirabad gen":"Zahirabad","zahirabad sc":"Zahirabad","zahirabad st":"Zahirabad","sangareddy gen":"Sangareddy","sangareddy sc":"Sangareddy","sangareddy st":"Sangareddy","patancheru gen":"Patancheru","patancheru sc":"Patancheru","patancheru st":"Patancheru","dubbak gen":"Dubbak","dubbak sc":"Dubbak","dubbak st":"Dubbak","gajwel gen":"Gajwel","gajwel sc":"Gajwel","gajwel st":"Gajwel","quthbullapur gen":"Quthbullapur","quthbullapur sc":"Quthbullapur","quthbullapur st":"Quthbullapur","kukatpally gen":"Kukatpally","kukatpally sc":"Kukatpally","kukatpally st":"Kukatpally","uppal gen":"Uppal","uppal sc":"Uppal","uppal st":"Uppal","malkajgiri gen":"Malkajgiri","malkajgiri sc":"Malkajgiri","malkajgiri st":"Malkajgiri","secunderabad cantonment gen":"Secunderabad Cantonment","secunderabad cantonment sc":"Secunderabad Cantonment","secunderabad cantonment st":"Secunderabad Cantonment","musheerabad gen":"Musheerabad","musheerabad sc":"Musheerabad","musheerabad st":"Musheerabad","malakpet gen":"Malakpet","malakpet sc":"Malakpet","malakpet st":"Malakpet","amberpet gen":"Amberpet","amberpet sc":"Amberpet","amberpet st":"Amberpet","khairatabad gen":"Khairatabad","khairatabad sc":"Khairatabad","khairatabad st":"Khairatabad","jubilee hills gen":"Jubilee Hills","jubilee hills sc":"Jubilee Hills","jubilee hills st":"Jubilee Hills","sanathnagar gen":"Sanathnagar","sanathnagar sc":"Sanathnagar","sanathnagar st":"Sanathnagar","nampally gen":"Nampally","nampally sc":"Nampally","nampally st":"Nampally","karwan gen":"Karwan","karwan sc":"Karwan","karwan st":"Karwan","goshamahal gen":"Goshamahal","goshamahal sc":"Goshamahal","goshamahal st":"Goshamahal","charminar gen":"Charminar","charminar sc":"Charminar","charminar st":"Charminar","chandrayangutta gen":"Chandrayangutta","chandrayangutta sc":"Chandrayangutta","chandrayangutta st":"Chandrayangutta","yakutpura gen":"Yakutpura","yakutpura sc":"Yakutpura","yakutpura st":"Yakutpura","bahadurpura gen":"Bahadurpura","bahadurpura sc":"Bahadurpura","bahadurpura st":"Bahadurpura","maheshwaram gen":"Maheshwaram","maheshwaram sc":"Maheshwaram","maheshwaram st":"Maheshwaram","rajendranagar gen":"Rajendranagar","rajendranagar sc":"Rajendranagar","rajendranagar st":"Rajendranagar","serilingampally gen":"Serilingampally","serilingampally sc":"Serilingampally","serilingampally st":"Serilingampally","chevella gen":"Chevella","chevella sc":"Chevella","chevella st":"Chevella","pargi gen":"Pargi","pargi sc":"Pargi","pargi st":"Pargi","vikarabad gen":"Vikarabad","vikarabad sc":"Vikarabad","vikarabad st":"Vikarabad","tandur gen":"Tandur","tandur sc":"Tandur","tandur st":"Tandur","kodangal gen":"Kodangal","kodangal sc":"Kodangal","kodangal st":"Kodangal","narayanpet gen":"Narayanpet","narayanpet sc":"Narayanpet","narayanpet st":"Narayanpet","mahbubnagar gen":"Mahbubnagar","mahbubnagar sc":"Mahbubnagar","mahbubnagar st":"Mahbubnagar","jadcherla gen":"Jadcherla","jadcherla sc":"Jadcherla","jadcherla st":"Jadcherla","devarkadra gen":"Devarkadra","devarkadra sc":"Devarkadra","devarkadra st":"Devarkadra","makthal gen":"Makthal","makthal sc":"Makthal","makthal st":"Makthal","wanaparthy gen":"Wanaparthy","wanaparthy sc":"Wanaparthy","wanaparthy st":"Wanaparthy","gadwal gen":"Gadwal","gadwal sc":"Gadwal","gadwal st":"Gadwal","alampur gen":"Alampur","alampur sc":"Alampur","alampur st":"Alampur","nagarkurnool gen":"Nagarkurnool","nagarkurnool sc":"Nagarkurnool","nagarkurnool st":"Nagarkurnool","achampet gen":"Achampet","achampet sc":"Achampet","achampet st":"Achampet","kalwakurthy gen":"Kalwakurthy","kalwakurthy sc":"Kalwakurthy","kalwakurthy st":"Kalwakurthy","shadnagar gen":"Shadnagar","shadnagar sc":"Shadnagar","shadnagar st":"Shadnagar","kollapur gen":"Kollapur","kollapur sc":"Kollapur","kollapur st":"Kollapur","devarakonda gen":"Devarakonda","devarakonda sc":"Devarakonda","devarakonda st":"Devarakonda","nagarjuna sagar gen":"Nagarjuna Sagar","nagarjuna sagar sc":"Nagarjuna Sagar","nagarjuna sagar st":"Nagarjuna Sagar","miryalaguda gen":"Miryalaguda","miryalaguda sc":"Miryalaguda","miryalaguda st":"Miryalaguda","huzurnagar gen":"Huzurnagar","huzurnagar sc":"Huzurnagar","huzurnagar st":"Huzurnagar","kodad gen":"Kodad","kodad sc":"Kodad","kodad st":"Kodad","suryapet gen":"Suryapet","suryapet sc":"Suryapet","suryapet st":"Suryapet","nalgonda gen":"Nalgonda","nalgonda sc":"Nalgonda","nalgonda st":"Nalgonda","munugode gen":"Munugode","munugode sc":"Munugode","munugode st":"Munugode","bhongir gen":"Bhongir","bhongir sc":"Bhongir","bhongir st":"Bhongir","nakrekal gen":"Nakrekal","nakrekal sc":"Nakrekal","nakrekal st":"Nakrekal","thungathurthi gen":"Thungathurthi","thungathurthi sc":"Thungathurthi","thungathurthi st":"Thungathurthi","alair gen":"Alair","alair sc":"Alair","alair st":"Alair","jangaon gen":"Jangaon","jangaon sc":"Jangaon","jangaon st":"Jangaon","ghanpur station gen":"Ghanpur (Station)","ghanpur station sc":"Ghanpur (Station)","ghanpur station st":"Ghanpur (Station)","palakurthi gen":"Palakurthi","palakurthi sc":"Palakurthi","palakurthi st":"Palakurthi","dornakal gen":"Dornakal","dornakal sc":"Dornakal","dornakal st":"Dornakal","mahabubabad gen":"Mahabubabad","mahabubabad sc":"Mahabubabad","mahabubabad st":"Mahabubabad","narsampet gen":"Narsampet","narsampet sc":"Narsampet","narsampet st":"Narsampet","parkal gen":"Parkal","parkal sc":"Parkal","parkal st":"Parkal","warangal west gen":"Warangal West","warangal west sc":"Warangal West","warangal west st":"Warangal West","warangal east gen":"Warangal East","warangal east sc":"Warangal East","warangal east st":"Warangal East","wardhannapet gen":"Wardhannapet","wardhannapet sc":"Wardhannapet","wardhannapet st":"Wardhannapet","bhupalpalle gen":"Bhupalpalle","bhupalpalle sc":"Bhupalpalle","bhupalpalle st":"Bhupalpalle","mulug gen":"Mulug","mulug sc":"Mulug","mulug st":"Mulug","pinapaka gen":"Pinapaka","pinapaka sc":"Pinapaka","pinapaka st":"Pinapaka","yellandu gen":"Yellandu","yellandu sc":"Yellandu","yellandu st":"Yellandu","khammam gen":"Khammam","khammam sc":"Khammam","khammam st":"Khammam","palair gen":"Palair","palair sc":"Palair","palair st":"Palair","madhira gen":"Madhira","madhira sc":"Madhira","madhira st":"Madhira","wyra gen":"Wyra","wyra sc":"Wyra","wyra st":"Wyra","sathupalli gen":"Sathupalli","sathupalli sc":"Sathupalli","sathupalli st":"Sathupalli","kothagudem gen":"Kothagudem","kothagudem sc":"Kothagudem","kothagudem st":"Kothagudem","aswaraopeta gen":"Aswaraopeta","aswaraopeta sc":"Aswaraopeta","aswaraopeta st":"Aswaraopeta","bhadrachalam gen":"Bhadrachalam","bhadrachalam sc":"Bhadrachalam","bhadrachalam st":"Bhadrachalam","secunderabad gen":"Secunderabad","secunderabad sc":"Secunderabad","secunderabad st":"Secunderabad","lal bahadur nagar gen":"Lal Bahadur Nagar","lal bahadur nagar sc":"Lal Bahadur Nagar","lal bahadur nagar st":"Lal Bahadur Nagar","ibrahimpatnam gen":"Ibrahimpatnam","ibrahimpatnam sc":"Ibrahimpatnam","ibrahimpatnam st":"Ibrahimpatnam","medchal gen":"Medchal","medchal sc":"Medchal","medchal st":"Medchal"}};


// ── Config ────────────────────────────────────────────────
const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;
const ROLES = ["admin"] as const;

// ── Crypto helpers (same idea as Node auth) ───────────────
async function pbkdf2Hash(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)),
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const hash = [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2:${saltHex}:${hash}`;
}

async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  return pbkdf2Hash(password, saltHex);
}

/** Strong random password for Super Admin bootstrap (never committed to the repo). */
function randomPassword(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return [...out].map((b) => chars[b % chars.length]).join("");
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!stored) return false;
  // Node scrypt format: salt:hash (no prefix) — cannot verify on Deno edge easily
  // Accept PBKDF2: pbkdf2:salt:hash
  if (stored.startsWith("pbkdf2:")) {
    const [, saltHex, hash] = stored.split(":");
    const next = await pbkdf2Hash(password, saltHex);
    return next === `pbkdf2:${saltHex}:${hash}`;
  }
  // Fallback: for playground demo, allow plain env seed passwords via re-seed
  return false;
}

function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-auth-token",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    },
  });
}

function corsHeaders(_req?: Request): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-auth-token, accept, origin, range, content-disposition",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-expose-headers": "content-disposition, content-type, content-length, location",
  };
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const x = req.headers.get("x-auth-token");
  if (x) return x;
  try {
    const u = new URL(req.url);
    return u.searchParams.get("token") || u.searchParams.get("auth");
  } catch {
    return null;
  }
}

async function getUser(token: string | null) {
  if (!token || !sql) return null;
  const rows = await sql`
    SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at,
           u.company_id, u.company_name,
           u.key_id, u.phone, u.photo, u.aadhaar_front, u.aadhaar_back,
           COALESCE(u.verified, FALSE) AS verified,
           COALESCE(u.can_manage_questions, FALSE) AS can_manage_questions,
           COALESCE(u.can_edit_surveys, FALSE) AS can_edit_surveys,
           COALESCE(u.can_review_data, FALSE) AS can_review_data,
           COALESCE(u.can_verify_surveyors, FALSE) AS can_verify_surveyors,
           COALESCE(u.can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
           COALESCE(u.can_validate_proof, FALSE) AS can_validate_proof,
           COALESCE(u.max_questions_per_survey, 0) AS max_questions_per_survey,
           COALESCE(u.max_surveys, 0) AS max_surveys,
           COALESCE(u.max_surveyors, 0) AS max_surveyors
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
      AND u.active = TRUE
      AND u.role IN ('super_admin', 'admin', 'surveyor')
    LIMIT 1
  `.catch(async () =>
    await sql`
      SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at,
             NULL AS company_id, NULL AS company_name,
             NULL AS key_id, NULL AS phone, NULL AS photo, NULL AS aadhaar_front, NULL AS aadhaar_back,
             FALSE AS verified, FALSE AS can_manage_questions, FALSE AS can_edit_surveys,
             FALSE AS can_review_data, FALSE AS can_verify_surveyors, FALSE AS can_crud_questionnaire,
             FALSE AS can_validate_proof, 0 AS max_questions_per_survey, 0 AS max_surveys,
             0 AS max_surveyors
      FROM app_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token = ${token}
        AND s.expires_at > NOW()
        AND u.active = TRUE
        AND u.role IN ('super_admin', 'admin', 'surveyor')
      LIMIT 1
    `.catch(() => [])
  );
  const u = rows[0] as Record<string, unknown> | undefined;
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.display_name || u.username,
    role: u.role,
    active: u.active,
    created_at: u.created_at,
    key_id: u.key_id || null,
    phone: u.phone || null,
    photo: u.photo || null,
    aadhaar_front: u.aadhaar_front || null,
    aadhaar_back: u.aadhaar_back || null,
    verified: u.verified === true,
    can_manage_questions: (u as Record<string, unknown>).can_manage_questions === true,
    can_edit_surveys: (u as Record<string, unknown>).can_edit_surveys === true,
    can_review_data: (u as Record<string, unknown>).can_review_data === true,
    can_verify_surveyors: (u as Record<string, unknown>).can_verify_surveyors === true,
    can_crud_questionnaire: (u as Record<string, unknown>).can_crud_questionnaire === true,
    can_validate_proof: (u as Record<string, unknown>).can_validate_proof === true,
    max_questions_per_survey: Number((u as Record<string, unknown>).max_questions_per_survey) || 0,
    max_surveys: Number((u as Record<string, unknown>).max_surveys) || 0,
    max_surveyors: Number((u as Record<string, unknown>).max_surveyors) || 0,
  };
}

/** Portal roles: Client Admin + platform Super Admin (01-PRD.md §2). Super Admin has all admin powers. */
function isPortalAdmin(role: unknown): boolean {
  return role === "admin" || role === "super_admin";
}

/** Grant-based power check — Super Admin always has every power; Client Admins need the grant. */
function hasPower(
  me: { role: unknown } & Record<string, unknown> | null,
  key: string,
): boolean {
  return !!me && (me.role === "super_admin" || me[key] === true);
}

/**
 * Append a platform audit-log entry (FR-AUD-01/02) — fire-and-forget so the
 * request path never slows down. Actor is the specific account (id + username),
 * never just the role.
 */
function logAudit(
  actor: { id: unknown; username: unknown; role: unknown } | null,
  action: string,
  entityType?: string,
  entityId?: unknown,
  meta?: Record<string, unknown>,
): void {
  if (!sql || !actor) return;
  void sql`
    INSERT INTO audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_id, meta)
    VALUES (
      ${actor.id},
      ${actor.username},
      ${actor.role},
      ${action},
      ${entityType || null},
      ${entityId != null ? String(entityId) : null},
      ${JSON.stringify(meta || {})}::jsonb
    )
  `.catch(() => null);
}


/** Unique surveyor key ID, e.g. GROUND-8F3K2Q (no 0/O/1/I) */
function genUserKeyId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let k = "";
  for (let i = 0; i < 6; i++) {
    k += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GROUND-${k}`;
}

async function uniqueUserKeyId(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const k = genUserKeyId();
    const hit = await sql`SELECT id FROM app_users WHERE key_id = ${k} LIMIT 1`.catch(() => []);
    if (!hit.length) return k;
  }
  return `GROUND-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/** Default Q/A form loaded by field app (admin can edit via dashboard) */
const DEFAULT_QUESTIONS = [
  {
    id: "respondent_name",
    label: "Respondent full name",
    type: "text",
    required: true,
    speak: "What is the respondent full name?",
  },
  {
    id: "district",
    label: "District",
    type: "text",
    required: true,
    speak: "Which district?",
  },
  {
    id: "constituency",
    label: "Assembly constituency",
    type: "text",
    required: true,
    speak: "Which assembly constituency?",
  },
  {
    id: "gender",
    label: "Gender",
    type: "choice",
    options: ["Male", "Female", "Other"],
    required: true,
    speak: "Gender of the respondent?",
  },
  {
    id: "caste",
    label: "Caste category",
    type: "choice",
    options: ["BC", "SC", "ST", "OC", "Minority", "Other"],
    required: false,
    speak: "Caste category?",
  },
  {
    id: "age",
    label: "Age group",
    type: "choice",
    options: ["18-25", "26-35", "36-45", "46-60", "60+"],
    required: false,
    speak: "Age group?",
  },
  {
    id: "winning_party",
    label: "Who will win here?",
    type: "choice",
    options: ["Congress", "BJP", "BRS", "Others", "Undecided"],
    required: true,
    speak: "According to them who will win?",
  },
  {
    id: "pm_preference",
    label: "Preferred PM",
    type: "choice",
    options: ["Narendra Modi", "Rahul Gandhi", "Other", "Undecided"],
    required: false,
    speak: "Preferred Prime Minister?",
  },
  {
    id: "performance",
    label: "Government performance",
    type: "choice",
    options: ["Excellent", "Good", "Average", "Poor", "Very Poor"],
    required: false,
    speak: "How is government performance?",
  },
  {
    id: "issues",
    label: "Top issues (comma separated)",
    type: "text",
    required: false,
    speak: "What are the main issues?",
  },
  {
    id: "notes",
    label: "Notes",
    type: "text",
    required: false,
    speak: "Any extra notes?",
  },
];

// Legacy rows (excel-upload / old app): no GPS/camera, but answers exist.
// Question definitions matching the excel columns so the Report/Analyze tabs
// build question filters + charts for the legacy survey (empty options = the
// analytics pipeline collects actual submitted values automatically).
const LEGACY_QUESTIONS = [
  {
    id: "gender",
    label: "Gender",
    type: "choice",
    options: ["Male", "Female", "Other"],
    required: true,
  },
  {
    id: "caste",
    label: "Caste category",
    type: "choice",
    options: ["BC", "SC", "ST", "OC", "Minority", "Other"],
    required: false,
  },
  {
    id: "age",
    label: "Age group",
    type: "age",
    required: false,
  },
  {
    id: "education",
    label: "Education",
    type: "choice",
    options: [],
    required: false,
  },
  {
    id: "employment",
    label: "Employment",
    type: "choice",
    options: [],
    required: false,
  },
  {
    id: "performance",
    label: "Government performance",
    type: "choice",
    options: [],
    required: false,
  },
  {
    id: "winning_party",
    label: "Who will win here?",
    type: "choice",
    options: ["Congress", "BJP", "BRS", "Others", "Undecided"],
    required: true,
  },
  {
    id: "pm_preference",
    label: "Preferred PM",
    type: "choice",
    options: ["Narendra Modi", "Rahul Gandhi", "Other", "Undecided"],
    required: false,
  },
  {
    id: "ward",
    label: "Ward",
    type: "text",
    required: false,
  },
  {
    id: "issues",
    label: "Top issues (comma separated)",
    type: "text",
    required: false,
  },
];

async function ensureSchema() {
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Admin-assigned target: how many records each surveyor must complete
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
    .catch(() => null);
  // Surveyor profile: unique key ID + contact + photo + Aadhaar card images
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS key_id TEXT`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone TEXT`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS photo TEXT`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS aadhaar_front TEXT`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS aadhaar_back TEXT`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => null);
  // Grant-based powers for Client Admins (FR-QB-02 governance, least privilege):
  // question-bank CRUD, survey-question editing, data review/verification, surveyor verification.
  // Super Admin always has all powers; each is granted/revoked per account by Super Admin only.
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_manage_questions BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_edit_surveys BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_review_data BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_verify_surveyors BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_crud_questionnaire BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_validate_proof BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => null);
  // Super-Admin-set cap on how many questions a Client Admin may put into one survey (0 = unlimited)
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_questions_per_survey INT NOT NULL DEFAULT 0`.catch(() => null);
  // Super-Admin-set cap on how many surveys a Client Admin may create (0 = unlimited)
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_surveys INT NOT NULL DEFAULT 0`.catch(() => null);
  await sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS created_by INT`.catch(() => null);
  // Company a project is mapped under (registered at creation by the Super Admin).
  await sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS company_name TEXT`.catch(() => null);
  // Companies registry (Super Admin creates them; Client Admins are added to them).
  // company_name on app_users stays in sync for display/back-compat.
  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS company_id INT`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_app_users_company ON app_users(company_id)`.catch(() => null);
  // Super-Admin-set cap on how many surveyors a Client Admin may create (0 = unlimited)
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_surveyors INT NOT NULL DEFAULT 0`.catch(() => null);
  // Ownership: who created each account — surveyor caps count accounts created by that admin
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS created_by INT`.catch(() => null);
  // Client Admin organisation.  Super Admin uses this to identify the company
  // receiving access to a project; it is deliberately not a surveyor field.
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS company_name TEXT`.catch(() => null);
  // Unique key ID backfill for existing users (idempotent — different key per row)
  const noKey = await sql`
    SELECT id FROM app_users WHERE key_id IS NULL OR key_id = ''
  `.catch(() => []);
  for (const r of noKey as { id: number }[]) {
    await sql`UPDATE app_users SET key_id = ${await uniqueUserKeyId()} WHERE id = ${r.id}`
      .catch(() => null);
  }
  // Super Admin bootstrap (12-DEPLOYMENT.md §4): OPT-IN via SUPER_ADMIN_AUTO_BOOTSTRAP=1.
  // Default is the UI path — the first portal admin creates the first Super Admin from the
  // Surveyors page (no secrets printed, no logs to fish through).
  if ((Deno.env.get("SUPER_ADMIN_AUTO_BOOTSTRAP") || "0") === "1") {
  try {
    const saRows = await sql`SELECT COUNT(*) AS n FROM app_users WHERE role = 'super_admin'`;
    const saCount = Number((saRows[0] as { n?: unknown } | undefined)?.n ?? 0);
    if (saCount === 0) {
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('super_admin','admin','field','user','surveyor'))`.catch(() => null);
      const saPass = randomPassword(18);
      const saHash = await hashPasswordAsync(saPass);
      const saInserted = await sql`
        INSERT INTO app_users (username, password_hash, display_name, role, active, key_id)
        VALUES ('superadmin', ${saHash}, 'Super Admin', 'super_admin', TRUE, ${await uniqueUserKeyId()})
        ON CONFLICT (username) DO NOTHING
        RETURNING id, role
      `.catch(() => []);
      const saCreated = (saInserted as { id?: unknown; role?: unknown }[])[0];
      if (saCreated && saCreated.role === "super_admin") {
        console.log("=== SUPER ADMIN BOOTSTRAP (printed once — keep private) ===");
        console.log("username: superadmin");
        console.log(`password: ${saPass}`);
        console.log("Change it after first login.");
      } else {
        console.log(
          "super admin bootstrap: 'superadmin' username already in use — no account created. Use /api/super-admin.",
        );
      }
    }
  } catch (e) {
    console.log("super admin bootstrap skipped:", (e as Error).message);
  }
  }

  await sql`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS submissions (
      id BIGSERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Dynamic questions form (admin dashboard → field app)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_form (
      id SERIAL PRIMARY KEY,
      form_key TEXT NOT NULL UNIQUE DEFAULT 'default',
      title TEXT NOT NULL DEFAULT 'Field Survey',
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);

  // Media separate from Q/A JSON — prefer free external URL links (not Neon base64)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_media (
      id BIGSERIAL PRIMARY KEY,
      submission_id BIGINT REFERENCES submissions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      mime TEXT,
      data TEXT,
      url TEXT,
      storage TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);

  await sql`ALTER TABLE survey_media ADD COLUMN IF NOT EXISTS url TEXT`.catch(() => null);
  await sql`ALTER TABLE survey_media ADD COLUMN IF NOT EXISTS storage TEXT`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_media_sub ON survey_media(submission_id)`.catch(() => null);

  // Multi-survey: surveyors assigned to a survey (field team per survey)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_assignments (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES survey_form(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (survey_id, user_id)
    )
  `.catch(() => null);

  // Multi-survey: respondent list per survey (name/phone, mark done)
  await sql`
    CREATE TABLE IF NOT EXISTS survey_respondents (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES survey_form(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      done_at TIMESTAMPTZ,
      submission_id BIGINT REFERENCES submissions(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_respondents_survey ON survey_respondents(survey_id)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_assignments_survey ON survey_assignments(survey_id)`.catch(() => null);

  // Shared surveys: Super Admin maps which Client Admins get access to a survey.
  // The owner is survey_form.created_by; these rows grant additional admins access.
  await sql`
    CREATE TABLE IF NOT EXISTS survey_admin_access (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES survey_form(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (survey_id, admin_id)
    )
  `.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_admin_access_survey ON survey_admin_access(survey_id)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_survey_admin_access_admin ON survey_admin_access(admin_id)`.catch(() => null);

  // ── Platform governance (01-PRD.md Super Admin): audit log, global question bank, seat limits ──
  // FR-AUD-01/02: append-only platform audit trail, per actor account.
  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id INTEGER,
      actor_name TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action)`.catch(() => null);

  // FR-QB-02: question bank templates — is_global (Super Admin authored, all tenants)
  // vs private (Client Admin authored).
  await sql`
    CREATE TABLE IF NOT EXISTS question_bank (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_global BOOLEAN NOT NULL DEFAULT FALSE,
      created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_question_bank_global ON question_bank (is_global)`.catch(() => null);

  // BR-006 / FR-USR-10: seat-limit upgrade requests (Client Admin submits, Super Admin decides)
  await sql`
    CREATE TABLE IF NOT EXISTS seat_limit_requests (
      id SERIAL PRIMARY KEY,
      requested_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      requested_by_name TEXT,
      seat_role TEXT NOT NULL DEFAULT 'admin',
      requested_limit INTEGER NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      decided_by INTEGER,
      decided_by_name TEXT,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);
  await sql`
    CREATE TABLE IF NOT EXISTS seat_limits (
      seat_role TEXT PRIMARY KEY,
      approved_limit INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `.catch(() => null);
  // Default admin seats; approval of an upgrade request raises the limit (BR-006)
  await sql`
    INSERT INTO seat_limits (seat_role, approved_limit, updated_by)
    VALUES ('admin', 5, 'system default')
    ON CONFLICT (seat_role) DO NOTHING
  `.catch(() => null);

  // Seed default questions if empty
  try {
    const forms = await sql`SELECT id FROM survey_form WHERE form_key = 'default' LIMIT 1`;
    if (!forms.length) {
      await sql`
        INSERT INTO survey_form (form_key, title, questions)
        VALUES (
          'default',
          'Field Survey',
          ${JSON.stringify(DEFAULT_QUESTIONS)}::jsonb
        )
      `;
    }
  } catch (e) {
    console.warn("survey_form seed", e);
  }

  // Legacy rows (pre GPS/camera: excel-upload + old app, no geo, no media)
  // become their own survey so old data never mixes with current surveys,
  // and they are auto-confirmed so they appear in the report immediately.
  try {
    await sql`
      INSERT INTO survey_form (form_key, title, questions, updated_at)
      VALUES ('legacy', 'Legacy Data (no GPS/Camera)', ${JSON.stringify(LEGACY_QUESTIONS)}::jsonb, NOW())
      ON CONFLICT (form_key) DO NOTHING
    `;
    // Backfill: earlier deploys seeded the legacy survey with empty questions,
    // so the report had no filters/charts for it. Idempotent — only fills when empty.
    await sql`
      UPDATE survey_form
      SET questions = ${JSON.stringify(LEGACY_QUESTIONS)}::jsonb, updated_at = NOW()
      WHERE form_key = 'legacy'
        AND (questions IS NULL OR jsonb_array_length(questions) = 0)
    `;
  } catch (e) {
    console.warn("legacy survey seed", e);
  }
  try {
    await sql`
      UPDATE submissions
      SET payload = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(payload, '{form_key}', '"legacy"'::jsonb, true),
            '{status}', '"confirmed"'::jsonb, true
          ),
          '{confirmed_by}', '"system (legacy migration)"'::jsonb, true
        ),
        '{confirmed_at}', to_jsonb(NOW()), true
      )
      WHERE payload->'geo' IS NULL
        AND (payload->>'form_key' IS NULL OR payload->>'status' IS NULL)
    `;
  } catch (e) {
    console.warn("legacy migration", e);
  }

  // ── Fact layer (analytics read path — 09-ANALYTICS-SPEC / 17-PROCESSING-SEQUENCE) ──
  // One narrow row per confirmed record; dashboards read facts, never raw records.
  await sql`
    CREATE TABLE IF NOT EXISTS record_facts (
      submission_id BIGINT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
      survey_key TEXT NOT NULL DEFAULT 'default',
      submitted_by TEXT,
      district TEXT,
      constituency TEXT,
      filterable_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      geo JSONB,
      confirmed_at TIMESTAMPTZ NOT NULL,
      fact_status TEXT NOT NULL DEFAULT 'materialized',
      fact_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_record_facts_confirmed_at ON record_facts (confirmed_at DESC)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_record_facts_district ON record_facts (district)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_record_facts_status ON record_facts (fact_status)`.catch(() => null);
  // fact pipeline status on the record itself (surfaces in Review queue)
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fact_status TEXT`.catch(() => null);
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fact_error TEXT`.catch(() => null);
  // Allow surveyor role (Client Admin creates field collectors)
  await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
  await sql`
    ALTER TABLE app_users
    ADD CONSTRAINT app_users_role_check
    CHECK (role IN ('admin', 'field', 'user', 'surveyor'))
  `.catch(() => null);

  // Indexes for concurrent reads / filters at scale (safe IF NOT EXISTS)
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions (created_at DESC)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_district ON submissions ((payload->'answers'->>'district'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_party ON submissions ((payload->'answers'->>'winning_party'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_gender ON submissions ((payload->'answers'->>'gender'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_caste ON submissions ((payload->'answers'->>'caste'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_answers_ac ON submissions ((payload->'answers'->>'constituency'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_submitted_by ON submissions ((payload->>'submitted_by'))`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_submissions_payload_gin ON submissions USING GIN (payload jsonb_path_ops)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users (role, active)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_assembly_name ON assembly_constituencies (name)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_districts_name ON districts (name)`.catch(() => null);
  await sql`CREATE INDEX IF NOT EXISTS idx_mandals_district ON mandals (district)`.catch(() => null);

  // Keep legacy field/user inactive; surveyors are created from admin dashboard
  await sql`
    UPDATE app_users SET active = FALSE WHERE role IN ('field', 'user')
  `.catch(() => null);

  // Seed admin only (PBKDF2 for Deno verify)
  const seeds: [string, string, string, string][] = [
    ["admin", "admin123", "System Admin", "admin"],
  ];
  for (const [username, password, display_name, role] of seeds) {
    const found = await sql`SELECT id, password_hash FROM app_users WHERE username = ${username} LIMIT 1`;
    if (!found.length) {
      const password_hash = await hashPasswordAsync(password);
      await sql`
        INSERT INTO app_users (username, password_hash, display_name, role)
        VALUES (${username}, ${password_hash}, ${display_name}, ${role})
      `;
    } else {
      if (!String((found[0] as { password_hash: string }).password_hash).startsWith("pbkdf2:")) {
        const password_hash = await hashPasswordAsync(password);
        await sql`
          UPDATE app_users
          SET password_hash = ${password_hash}, role = 'admin', active = TRUE, display_name = ${display_name}
          WHERE username = ${username}
        `;
      } else {
        await sql`
          UPDATE app_users SET role = 'admin', active = TRUE WHERE username = ${username}
        `;
      }
    }
  }

  // Idempotent companies backfill: register any distinct company_names from app_users or survey_form into companies
  await sql`
    INSERT INTO companies (name, created_by)
    SELECT DISTINCT TRIM(company_name) AS name, NULL AS created_by
    FROM app_users
    WHERE company_name IS NOT NULL AND TRIM(company_name) <> ''
    ON CONFLICT (name) DO NOTHING
  `.catch(() => null);

  await sql`
    INSERT INTO companies (name, created_by)
    SELECT DISTINCT TRIM(company_name) AS name, NULL AS created_by
    FROM survey_form
    WHERE company_name IS NOT NULL AND TRIM(company_name) <> ''
    ON CONFLICT (name) DO NOTHING
  `.catch(() => null);

  await sql`
    UPDATE app_users u
    SET company_id = c.id, company_name = c.name
    FROM companies c
    WHERE LOWER(u.company_name) = LOWER(c.name) AND (u.company_id IS NULL OR u.company_id <> c.id)
  `.catch(() => null);
}

async function ensureCompanyExists(
  sqlClient: typeof sql,
  rawName: string | null | undefined,
  createdBy: number | null
): Promise<{ id: number; name: string } | null> {
  if (!rawName || !sqlClient) return null;
  const name = String(rawName).trim().slice(0, 160);
  if (!name) return null;

  try {
    const existing = await sqlClient`
      SELECT id, name FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1
    `.catch(() => []);
    if (existing.length) {
      const comp = { id: Number((existing[0] as { id: unknown }).id), name: String((existing[0] as { name: unknown }).name) };
      await sqlClient`
        UPDATE app_users
        SET company_id = ${comp.id}, company_name = ${comp.name}
        WHERE LOWER(company_name) = LOWER(${comp.name}) AND (company_id IS NULL OR company_id <> ${comp.id})
      `.catch(() => null);
      return comp;
    }

    const inserted = await sqlClient`
      INSERT INTO companies (name, created_by) VALUES (${name}, ${createdBy})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `.catch(() => []);
    if (inserted.length) {
      const comp = { id: Number((inserted[0] as { id: unknown }).id), name: String((inserted[0] as { name: unknown }).name) };
      await sqlClient`
        UPDATE app_users
        SET company_id = ${comp.id}, company_name = ${comp.name}
        WHERE LOWER(company_name) = LOWER(${comp.name}) AND (company_id IS NULL OR company_id <> ${comp.id})
      `.catch(() => null);
      return comp;
    }
  } catch (_e) {
    /* ignore fallback to re-select below */
  }

  const re = await sqlClient`
    SELECT id, name FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1
  `.catch(() => []);
  if (re.length) {
    return { id: Number((re[0] as { id: unknown }).id), name: String((re[0] as { name: unknown }).name) };
  }
  return null;
}

let schemaReady: Promise<void> | null = null;
function ready() {
  if (!schemaReady) {
    schemaReady = ensureSchema()
      .catch((e) => {
        console.error(e);
        schemaReady = null;
      })
      .then(() => {
        // Legacy fact catch-up runs AFTER the request path is served, so even a
        // large backfill can never stall boot or the deploy health check.
        if (sql) {
          void backfillFacts(sql).catch((e) => console.warn("fact backfill", e));
        }
      });
  }
  return schemaReady;
}

// ── Analytics helpers (filters + super-set / sub-set) ──────
/**
 * Answer lookup keyed by the Client Admin's question naming — matches
 * question id OR label, case-insensitively (question "Gender" ↔ answer "gender").
 */
function answerOf(a: Record<string, unknown> | undefined | null, qid: string, qlabel?: string): unknown {
  if (!a) return undefined;
  if (a[qid] != null) return a[qid];
  const low = qid.toLowerCase();
  for (const [k, v] of Object.entries(a)) {
    if (k.toLowerCase() === low) return v;
  }
  if (qlabel) {
    const lbl = qlabel.toLowerCase().trim();
    if (lbl && lbl !== low) {
      for (const [k, v] of Object.entries(a)) {
        if (k.toLowerCase() === lbl) return v;
      }
    }
  }
  return undefined;
}

// Age grouping — "age" type questions bucket answers into ranges everywhere
const AGE_RANGES = [
  { lo: 0, hi: 17, name: "0-17" },
  { lo: 18, hi: 25, name: "18-25" },
  { lo: 26, hi: 35, name: "26-35" },
  { lo: 36, hi: 45, name: "36-45" },
  { lo: 46, hi: 60, name: "46-60" },
  { lo: 61, hi: Infinity, name: "60+" },
];
const AGE_OPTIONS = AGE_RANGES.map((r) => r.name);
function ageBucket(v: unknown): string | null {
  const s = String(v ?? "").trim();
  // Range values like "26-35 years" (legacy excel) → exact bucket
  const range = s.match(/(\d{1,2})\s*[-–—to]+\s*(\d{1,3})/);
  if (range) {
    const hit = AGE_RANGES.find((r) => r.lo === Number(range[1]) && r.hi === Number(range[2]));
    if (hit) return hit.name;
  }
  const n = Number(s.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const r of AGE_RANGES) if (n >= r.lo && n <= r.hi) return r.name;
  return null;
}

function normParty(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Undecided";
  if (/bjp|బీజేపీ/i.test(s)) return "BJP";
  if (/congress|కాంగ్ర/i.test(s)) return "Congress";
  if (/brs|trs|బీఆర్/i.test(s)) return "BRS";
  if (/undecided|not decided/i.test(s)) return "Undecided";
  if (/other/i.test(s)) return "Others";
  return s;
}
function normGender(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Unknown";
  if (/^f|female|woman|స్త్రీ/i.test(s)) return "Female";
  if (/^m|male|man\b|పురుష/i.test(s)) return "Male";
  return s;
}
function normCaste(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Unknown";
  if (/\bbc\b|backward/i.test(s)) return "BC";
  if (/\bsc\b/i.test(s)) return "SC";
  if (/\bst\b/i.test(s)) return "ST";
  if (/\boc\b|open|forward/i.test(s)) return "OC";
  if (/minority|muslim/i.test(s)) return "Minority";
  return s;
}
function normPm(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Undecided";
  if (/modi|మోదీ/i.test(s)) return "Narendra Modi";
  if (/rahul|రాహుల్/i.test(s)) return "Rahul Gandhi";
  if (/undecided/i.test(s)) return "Undecided";
  if (/other/i.test(s)) return "Other";
  return s;
}
function softEq(a: string, b: string) {
  const n = (x: string) =>
    String(x || "")
      .toLowerCase()
      .replace(/\(([^)]*)\)/g, " $1 ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = n(a);
  const nb = n(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const alias: Record<string, string> = {
    jagitial: "jagtial",
    jagtial: "jagtial",
    bhongir: "bhuvanagiri",
    hanamkonda: "hanumakonda",
    hanumakonda: "hanumakonda",
    "warangal urban": "hanumakonda",
    "warangal city": "hanumakonda",
    "warangal rural": "warangal rural",
    "ranga reddy": "rangareddy",
    medchal: "medchal malkajgiri",
    "medchal malkajgiri": "medchal malkajgiri",
    bhadradri: "bhadradri kothagudem",
    "bhadradri kothagudem": "bhadradri kothagudem",
    jayashankar: "jayashankar bhupalapally",
    "jayashankar bhupalapally": "jayashankar bhupalapally",
    mahbubnagar: "mahabubnagar",
  };
  return (alias[na] || na) === (alias[nb] || nb) || na.includes(nb) || nb.includes(na);
}

function countBy(list: { key: string }[], keyFn: (r: { key: string }) => string) {
  const map = new Map<string, number>();
  for (const r of list) {
    const k = keyFn(r) || "Unknown";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value, pct: 0 }))
    .sort((a, b) => b.value - a.value);
}
function withPct(arr: { name: string; value: number; pct: number }[]) {
  const total = arr.reduce((s, x) => s + x.value, 0) || 1;
  return arr.map((x) => ({
    ...x,
    pct: Math.round((x.value / total) * 1000) / 10,
  }));
}
function pctDist(list: Record<string, unknown>[], key: string) {
  const total = list.length || 1;
  const map = new Map<string, number>();
  for (const r of list) {
    const k = String(r[key] || "Unknown");
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({
    name,
    value: Number(((value / total) * 100).toFixed(1)),
  }));
}
function compareSets(
  selected: { name: string; value: number }[],
  rest: { name: string; value: number }[],
  superPct: { name: string; value: number }[],
) {
  const names = new Set([
    ...selected.map((d) => d.name),
    ...rest.map((d) => d.name),
    ...superPct.map((d) => d.name),
  ]);
  return [...names]
    .map((name) => {
      const s = selected.find((d) => d.name === name)?.value ?? 0;
      const r = rest.find((d) => d.name === name)?.value ?? 0;
      const sp = superPct.find((d) => d.name === name)?.value ?? 0;
      return {
        name,
        selected: s,
        rest: r,
        super: sp,
        delta: Number((s - r).toFixed(1)),
        index: sp > 0 ? Number((s / sp).toFixed(2)) : null,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

type Row = {
  id: string | number;
  created_at: string;
  district: string;
  constituency: string;
  party: string;
  gender: string;
  caste: string;
  pm: string;
  performance: string;
  education: string;
  employment: string;
  age: string;
  mp: string;
  issues: string[];
  status: string;
  completeness: string;
  geo_ok: boolean;
  voice_ok: boolean;
  submitted_by: string;
  respondent: string;
  formKey: string;
  answers: Record<string, unknown>;
};

/** Report status: pending → confirmed (analytics) | rejected */
function payloadStatus(payload: Record<string, unknown>): string {
  const s = String(payload?.status || "").toLowerCase().trim();
  if (s === "confirmed" || s === "rejected" || s === "pending") return s;
  // legacy rows without status: pending until admin confirms
  return "pending";
}

/** Keys that are locks/geo metadata, not real survey answers */
function isMetaAnswerKey(k: string): boolean {
  const s = String(k || "").toLowerCase();
  if (!s || s.startsWith("_")) return true;
  if (s.startsWith("geo_") || s.startsWith("location_")) return true;
  return (
    s === "lat" ||
    s === "lng" ||
    s === "latitude" ||
    s === "longitude" ||
    s === "accuracy" ||
    s === "data_collector" ||
    s === "client_package_id" ||
    s === "surveyor" ||
    s === "agent"
  );
}

/**
 * Resolve surveyor display name from payload + answers (never invent from respondent).
 */
function surveyorNameOf(payload: Record<string, unknown>): string {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  const name = String(
    payload?.submitted_by ||
      a.data_collector ||
      a.surveyor ||
      a.agent ||
      "",
  ).trim();
  return name || "unknown";
}

/**
 * Field drafts are not finished work. Even if status was wrongly set to
 * confirmed, keep them out of "completed" and count under pending.
 * Example Anumula1: 3 status=pending + 1 confirmed-with-_draft → 4 pending, 6 completed.
 */
function isDraftSubmission(payload: Record<string, unknown>): boolean {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  return (
    payload?.draft === true ||
    a._draft === true ||
    a.draft === true ||
    String(payload?.content_type || "").toLowerCase() === "draft"
  );
}

/**
 * Surveyor work status for Report boards:
 * - completed = Client Admin confirmed AND not a draft
 * - pending   = still open (status pending/rejected OR still tagged draft)
 */
function workStatusOf(
  payload: Record<string, unknown>,
): "completed" | "pending" | "rejected" {
  const status = payloadStatus(payload);
  const draft = isDraftSubmission(payload);
  if (draft) return "pending";
  if (status === "confirmed") return "completed";
  if (status === "rejected") return "rejected";
  return "pending";
}

/**
 * Strict verification: geo tagging + voice (audio) required for COMPLETE.
 * Incomplete cannot enter confirmed analytics without override.
 *
 * LEGACY rows (collected before GPS/camera existed — no geo and never any
 * media) are exempt: they are not subject to the geo/voice/photo checks, so
 * old data can be confirmed and reported normally. Only at least one answer
 * is required.
 */
function verifySubmission(
  payload: Record<string, unknown>,
  mediaKinds: string[] = [],
) {
  const answers = (payload?.answers || {}) as Record<string, unknown>;
  const geoPayload = (payload?.geo || null) as Record<string, unknown> | null;
  // Fallback: some clients store coords only under answers.geo_lat / geo_lng
  const lat = Number(
    geoPayload != null
      ? (geoPayload.lat ?? geoPayload.latitude)
      : (answers.geo_lat ?? answers.latitude ?? answers.lat ?? NaN),
  );
  const lng = Number(
    geoPayload != null
      ? (geoPayload.lng ?? geoPayload.longitude)
      : (answers.geo_lng ?? answers.longitude ?? answers.lng ?? NaN),
  );
  const accuracyRaw =
    geoPayload != null && geoPayload.accuracy != null
      ? Number(geoPayload.accuracy)
      : answers.geo_accuracy != null
      ? Number(answers.geo_accuracy)
      : null;
  const accuracy = accuracyRaw != null && Number.isFinite(accuracyRaw)
    ? accuracyRaw
    : null;
  const hasGeoObject = geoPayload != null ||
    (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0));

  const geo_ok =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);

  const kinds = (mediaKinds || []).map((k) => String(k || "").toLowerCase());

  // URL / media-id on payload also count (R2 or free Neon links may not re-set flags)
  const hasPhotoUrl = Boolean(
    payload?.photo_url ||
      payload?.photo_media_id ||
      payload?.photoUrl ||
      payload?.photoMediaId,
  );
  const hasAudioUrl = Boolean(
    payload?.audio_url ||
      payload?.audio_media_id ||
      payload?.audioUrl ||
      payload?.audioMediaId,
  );

  // Legacy = pre GPS/camera data: no geo ever attached AND no media/flags/urls.
  // (New submissions always carry geo — the server requires it on POST.)
  const legacy =
    !hasGeoObject &&
    kinds.length === 0 &&
    payload?.has_photo !== true &&
    payload?.has_audio !== true &&
    !hasPhotoUrl &&
    !hasAudioUrl;

  // Voice: session audio stored separately or flagged on payload
  const hasAudioFlag = payload?.has_audio === true;
  const hasAudioMedia = kinds.includes("audio");
  const voice_ok = legacy || hasAudioFlag || hasAudioMedia || hasAudioUrl;

  const hasPhotoFlag = payload?.has_photo === true;
  const hasPhotoMedia = kinds.includes("photo");
  const photo_ok = legacy || hasPhotoFlag || hasPhotoMedia || hasPhotoUrl;

  // Real Q/A only — ignore lock flags / geo metadata stuffed into answers
  const answerKeys = Object.keys(answers).filter((k) => {
    if (isMetaAnswerKey(k)) return false;
    const v = answers[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim() !== "";
  });
  const qa_ok = answerKeys.length >= 1;

  const failures: string[] = [];
  if (!legacy) {
    if (!geo_ok) failures.push("geo_missing_or_invalid");
    if (!voice_ok) failures.push("voice_missing");
    if (!photo_ok) failures.push("photo_missing");
  }
  if (!qa_ok) failures.push("qa_empty");

  // Strict complete = geo + voice + photo + at least one real answer.
  // Legacy rows only need answers (no GPS/camera available back then).
  const completeness: "complete" | "incomplete" = legacy
    ? qa_ok
      ? "complete"
      : "incomplete"
    : geo_ok && voice_ok && photo_ok && qa_ok
    ? "complete"
    : "incomplete";

  return {
    completeness,
    legacy,
    geo_ok: legacy ? true : geo_ok,
    voice_ok,
    photo_ok,
    qa_ok,
    geo: geo_ok
      ? {
          lat,
          lng,
          accuracy,
          at: geoPayload?.at || answers.geo_at || null,
        }
      : geoPayload
      ? { lat: geoPayload.lat, lng: geoPayload.lng, invalid: true }
      : null,
    failures,
    checks: legacy
      ? {
          geo_tagging: "n/a",
          voice_detection: "n/a",
          photo: "n/a",
          qa: qa_ok ? "pass" : "fail",
        }
      : {
          geo_tagging: geo_ok ? "pass" : "fail",
          voice_detection: voice_ok ? "pass" : "fail",
          photo: photo_ok ? "pass" : "fail",
          qa: qa_ok ? "pass" : "fail",
        },
  };
}

/** Load submission_id → media kinds from survey_media (always Number keys). */
async function loadMediaKindsMap(
  sqlFn: NonNullable<typeof sql>,
): Promise<Map<number, string[]>> {
  const mediaMap = new Map<number, string[]>();
  const mediaRows = await sqlFn`
    SELECT submission_id, kind FROM survey_media
  `.catch(() => []);
  for (const m of mediaRows as { submission_id: number; kind: string }[]) {
    const sid = Number(m.submission_id);
    if (!Number.isFinite(sid)) continue;
    const kind = String(m.kind || "").toLowerCase();
    if (!kind) continue;
    const arr = mediaMap.get(sid) || [];
    arr.push(kind);
    mediaMap.set(sid, arr);
  }
  return mediaMap;
}

/** Apply media kinds onto payload flags then verify (single source of truth). */
function verifyWithMedia(
  payload: Record<string, unknown>,
  mediaMap: Map<number, string[]>,
  id: number | string,
) {
  const kinds = mediaMap.get(Number(id)) || [];
  if (kinds.includes("audio")) payload.has_audio = true;
  if (kinds.includes("photo")) payload.has_photo = true;
  return verifySubmission(payload, kinds);
}

/** Telugu place names → English (district etc.), applied when confirming */
const TELUGU_ALIAS: Record<string, string> = (GEO_ALIASES as {
  telugu?: Record<string, string>;
}).telugu || {};
const TELUGU_SCRIPT = /[\u0C00-\u0C7F]/;

function translateGeoEnglish(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const a = (payload.answers || {}) as Record<string, unknown>;
  const geoKeys = [
    "district",
    "location_district",
    "constituency",
    "assembly_constituency",
    "mp_constituency",
    "mandal",
    "location_mandal",
    "ward",
    "village",
    "revenue_division",
    "location_area",
    "location_state",
    "location_display",
  ];
  // Longer keys first so "వరంగల్ (అర్బన్)" beats "వరంగల్"
  const teluguEntries = Object.entries(TELUGU_ALIAS).sort(
    (x, y) => y[0].length - x[0].length,
  );
  const translate = (v: unknown): unknown => {
    if (typeof v !== "string" || !TELUGU_SCRIPT.test(v)) return v;
    const simple = v.replace(/\s+/g, " ").trim();
    const direct =
      TELUGU_ALIAS[simple] || TELUGU_ALIAS[simple.toLowerCase()];
    if (direct) return direct;
    let out = simple;
    for (const [te, en] of teluguEntries) {
      if (out.includes(te)) out = out.split(te).join(en);
    }
    return out !== simple ? out : v;
  };
  let changed = false;
  for (const k of geoKeys) {
    if (a[k] == null) continue;
    const t = translate(a[k]);
    if (t !== a[k]) {
      a[k] = t;
      changed = true;
    }
  }
  if (changed) {
    payload.answers = a;
    payload.translated_from_telugu = true;
  }
  return payload;
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/** Decode base64 (optionally data-URL stripped already) → bytes */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True if bytes start with a known image magic (JPEG/PNG/GIF/WebP/AVIF) */
function isImageBytes(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (bytes.length < 8) return false;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // require end marker so truncated files are rejected
    for (let i = Math.max(0, bytes.length - 2); i < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
    }
    return false;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true;
  }
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return true;
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/** Hex encode ArrayBuffer / Uint8Array */
function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const enc =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return toHex(hash);
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  msg: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}

/**
 * Cloudflare R2 PutObject (S3-compatible, SigV4).
 *
 * Bucket endpoint (this project):
 *   https://6f54ac7c46cba07b9dac5e1548348f4f.r2.cloudflarestorage.com/election-survey-media
 *
 * Env:
 *   R2_ACCOUNT_ID / R2_ENDPOINT   (defaults filled below)
 *   R2_BUCKET                     (default: election-survey-media)
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (required for upload)
 *   R2_PUBLIC_URL                 (public r2.dev or custom domain — required to open files)
 *
 * Free tier: 10 GB storage / month.
 */
const R2_DEFAULT_ACCOUNT_ID = "6f54ac7c46cba07b9dac5e1548348f4f";
const R2_DEFAULT_BUCKET = "election-survey-media";
const R2_DEFAULT_ENDPOINT =
  `https://${R2_DEFAULT_ACCOUNT_ID}.r2.cloudflarestorage.com`;

function r2Config(): {
  acc: string;
  host: string;
  buck: string;
  ak: string;
  sk: string;
  publicBase: string;
} {
  // Full endpoint like https://<account>.r2.cloudflarestorage.com  (optional /bucket)
  const endpointRaw = (
    Deno.env.get("R2_ENDPOINT") ||
    Deno.env.get("CLOUDFLARE_R2_ENDPOINT") ||
    R2_DEFAULT_ENDPOINT
  ).trim().replace(/\/$/, "");

  let accFromEndpoint = "";
  let hostFromEndpoint = "";
  try {
    const u = new URL(endpointRaw);
    hostFromEndpoint = u.host; // e.g. 6f54….r2.cloudflarestorage.com
    const m = hostFromEndpoint.match(/^([a-f0-9]+)\.r2\.cloudflarestorage\.com$/i);
    if (m) accFromEndpoint = m[1];
  } catch {
    /* ignore */
  }

  const accountId = (Deno.env.get("R2_ACCOUNT_ID") || "").trim();
  const accessKey = (Deno.env.get("R2_ACCESS_KEY_ID") || "").trim();
  const secretKey = (Deno.env.get("R2_SECRET_ACCESS_KEY") || "").trim();
  const bucket = (Deno.env.get("R2_BUCKET") || "").trim();
  let publicBase = (Deno.env.get("R2_PUBLIC_URL") || "").trim().replace(/\/$/, "");

  const acc =
    accountId ||
    (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "").trim() ||
    accFromEndpoint ||
    R2_DEFAULT_ACCOUNT_ID;
  const ak = accessKey || (Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") || "").trim();
  const sk = secretKey || (Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") || "").trim();
  const buck =
    bucket ||
    (Deno.env.get("CLOUDFLARE_R2_BUCKET") || "").trim() ||
    R2_DEFAULT_BUCKET;
  publicBase =
    publicBase ||
    (Deno.env.get("CLOUDFLARE_R2_PUBLIC_URL") || "").trim().replace(/\/$/, "");

  const host = hostFromEndpoint || `${acc}.r2.cloudflarestorage.com`;
  return { acc, host, buck, ak, sk, publicBase };
}

async function uploadToCloudflareR2(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  objectKey: string,
): Promise<{ url: string; provider: string } | null> {
  const { acc, host, buck, ak, sk, publicBase } = r2Config();

  // Keys + public base required; account/bucket have project defaults
  if (!acc || !ak || !sk || !buck || !publicBase) {
    if (!ak || !sk) {
      console.warn("[r2] skip: missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
    } else if (!publicBase) {
      console.warn(
        "[r2] skip: set R2_PUBLIC_URL (r2.dev public link), e.g. https://pub-xxxxx.r2.dev",
      );
    }
    return null;
  }

  const region = "auto";
  const pathKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const url = `https://${host}/${buck}/${pathKey}`;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const amz =
    `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const payloadHash = await sha256Hex(bytes);
  const canonicalHeaders =
    `content-type:${mime}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amz}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    `/${buck}/${pathKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(
    new TextEncoder().encode("AWS4" + sk),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Do not set Host header manually — Deno/fetch sets it from the URL (must match signed host)
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amz,
      Authorization: authorization,
    },
    body: bytes,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[r2] put failed", res.status, errText.slice(0, 300));
    return null;
  }

  // Public URL for browsers (r2.dev) — not the private S3 endpoint
  const publicPath = objectKey.split("/").map(encodeURIComponent).join("/");
  return {
    url: `${publicBase}/${publicPath}`,
    provider: "cloudflare_r2",
  };
}

/**
 * Optional external upload — ONLY if already configured (never required, no card).
 * Default path is Neon (DATABASE_URL you already use) — no credit card.
 */
async function tryOptionalExternalUpload(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  kind: string,
  objectKey: string,
  filename: string,
): Promise<{ url: string; provider: string } | null> {
  // Cloudflare R2 only when ALL env vars set (skip if missing — no card signup needed)
  try {
    const r2 = await uploadToCloudflareR2(bytes, mime, objectKey);
    if (r2?.url) return r2;
  } catch {
    /* ignore */
  }

  const custom = (Deno.env.get("MEDIA_UPLOAD_URL") || "").trim();
  if (!custom) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), filename);
    form.append("kind", kind);
    const key = Deno.env.get("MEDIA_UPLOAD_KEY") || "";
    const res = await fetch(custom, {
      method: "POST",
      body: form,
      headers: {
        "User-Agent": "GroundIQ-ElectionSurvey/1.6",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    });
    const text = (await res.text()).trim();
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        const u = j.url || j.link || j.href;
        if (u) return { url: String(u), provider: "custom" };
      } catch {
        if (text.startsWith("http")) return { url: text, provider: "custom" };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/**
 * Store photo/audio linked to submission.
 * DEFAULT: Neon free DB (no card) — data column + API file link.
 * OPTIONAL: R2/custom only if env already set.
 */
async function storeMediaLinked(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  kind: string,
): Promise<{
  url: string | null;
  provider: string;
  dataB64: string | null;
  mode: "external" | "neon";
}> {
  const ext =
    kind === "photo"
      ? "jpg"
      : mime.includes("webm")
      ? "webm"
      : mime.includes("mp4")
      ? "m4a"
      : "bin";
  const day = new Date().toISOString().slice(0, 10);
  const objectKey = `election-survey/${kind}/${day}/${crypto.randomUUID()}.${ext}`;
  const filename = `esurvey-${kind}-${Date.now()}.${ext}`;

  // Prefer external ONLY if pre-configured (Cloudflare etc.) — never force signup/card
  const external = await tryOptionalExternalUpload(
    bytes,
    mime,
    kind,
    objectKey,
    filename,
  );
  if (external) {
    return {
      url: external.url,
      provider: external.provider,
      dataB64: null,
      mode: "external",
    };
  }

  // DEFAULT: Neon — no credit card, uses your existing free Neon project
  // Cap ~700KB binary (~930KB base64) to protect free tier
  if (bytes.length > 700_000) {
    throw new Error(
      "Media too large for free Neon storage (max ~700KB). Use a smaller photo / shorter audio.",
    );
  }
  return {
    url: null, // filled after insert with /api/media/:id/file
    provider: "neon",
    dataB64: bytesToBase64(bytes),
    mode: "neon",
  };
}

function dayKey(iso: string) {
  return String(iso || "").slice(0, 10);
}

// Neon returns TIMESTAMPTZ as Date objects; String(Date) yields locale text
// ("Tue Aug 04 2026…") which breaks dayKey()/date comparisons. Always ISO.
function isoStamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v || "");
}

function qaFromAnswers(a: Record<string, unknown>) {
  const keys = [
    ["respondent_name", "Respondent"],
    ["district", "District"],
    ["constituency", "Assembly (AC)"],
    ["mandal", "Mandal"],
    ["gender", "Gender"],
    ["caste", "Caste"],
    ["age", "Age"],
    ["education", "Education"],
    ["employment", "Employment"],
    ["winning_party", "Winning party"],
    ["pm_preference", "PM preference"],
    ["performance", "Govt performance"],
    ["issues", "Issues"],
    ["notes", "Notes"],
    ["phone", "Phone"],
    ["data_collector", "Collector"],
  ];
  return keys
    .map(([k, label]) => {
      let v = a[k];
      if (Array.isArray(v)) v = v.join(", ");
      if (v == null || v === "") return null;
      return { q: label, a: String(v) };
    })
    .filter(Boolean) as { q: string; a: string }[];
}

/** Load + resolve all submissions into analytics rows (AC → district resolution, mandal fallback, party/gender/caste normalisation). Shared by analytics + export. */
// ── Fact materialization (Processing — 17-ANALYTICS-PROCESSING-SEQUENCE.md §1.2/§3) ──

/** Answer keys that are internal bookkeeping, never analytics facts. */
const FACT_META_KEYS = new Set([
  "_draft", "draft", "_startedAt", "_lastQuestion", "_answeredCount", "_syncedAt",
  "_recordIndex", "recordIndex", "data_collector", "submitted_by", "notes",
  // geo-ish / media-ish keys are bookkeeping — geo lives on record_facts.geo instead
  "latitude", "longitude", "lat", "lng", "geo_lat", "geo_lng", "gps_lat", "gps_lng",
]);

/** Normalize an answer value into its fact-safe form (09-ANALYTICS-SPEC §2.1). */
function normalizeFactValue(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].sort();
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (Number.isFinite(Number(s)) && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Narrow fact payload: only real answer keys (metadata/media excluded) — keeps the table lean. */
function buildFilterableAnswers(payload: Record<string, unknown>): Record<string, unknown> {
  const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (FACT_META_KEYS.has(k)) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) continue; // no nested blobs in facts
    const norm = normalizeFactValue(v);
    if (norm !== null && norm !== undefined && !(Array.isArray(norm) && norm.length === 0)) {
      out[k] = norm;
    }
  }
  return out;
}

/**
 * Insert one record_facts row for a confirmed submission. Idempotent
 * (ON CONFLICT DO NOTHING). On unexpected error the record is flagged
 * fact_status='failed' for manual retry — the confirm decision is never lost.
 */
async function materializeFact(
  sqlFn: NonNullable<typeof sql>,
  submissionId: number,
): Promise<{ inserted: boolean; already_existed: boolean }> {
  const rows = await sqlFn`SELECT id, payload FROM submissions WHERE id = ${submissionId}`;
  if (!rows.length) throw new Error("submission not found");
  const payload = parsePayload((rows[0] as { payload: unknown }).payload);
  if (payloadStatus(payload) !== "confirmed") {
    throw new Error("record is not confirmed — facts are only materialized for confirmed records");
  }
  const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
  const surveyKey = String(payload.form_key || payload.formKey || "default");
  const confirmedAt = String(payload.confirmed_at || new Date().toISOString());
  const geo = (payload.geo as Record<string, unknown> | undefined) || null;
  const filterable = buildFilterableAnswers(payload);

  const inserted = await sqlFn`
    INSERT INTO record_facts (
      submission_id, survey_key, submitted_by, district, constituency,
      filterable_answers, geo, confirmed_at, fact_status
    ) VALUES (
      ${submissionId}, ${surveyKey}, ${surveyorNameOf(payload)},
      ${String(answers.district || "").trim()}, ${String(answers.constituency || "").trim()},
      ${JSON.stringify(filterable)}::jsonb, ${geo ? JSON.stringify(geo) : null}::jsonb,
      ${confirmedAt}::timestamptz, 'materialized'
    )
    ON CONFLICT (submission_id) DO NOTHING
    RETURNING submission_id
  `;
  await sqlFn`
    UPDATE submissions SET fact_status = 'materialized', fact_error = NULL WHERE id = ${submissionId}
  `.catch(() => null);
  return {
    inserted: inserted.length > 0,
    already_existed: inserted.length === 0,
  };
}

/** Flag a record so Review surfaces it and retry-fact can re-run materialization. */
async function markFactFailed(sqlFn: NonNullable<typeof sql>, id: number, err: unknown) {
  const msg = String((err as Error)?.message || err || "unknown error").slice(0, 500);
  await sqlFn`UPDATE submissions SET fact_status = 'failed', fact_error = ${msg} WHERE id = ${id}`.catch(() => null);
}

/**
 * Idempotent fact catch-up for confirmed submissions without a fact row.
 * Batched multi-row INSERTs — never one query per row — so even thousands of
 * legacy rows complete in a handful of round trips (boot/first-request safe).
 */
async function backfillFacts(
  sqlFn: NonNullable<typeof sql>,
  opts: { limit?: number } = {},
): Promise<{ materialized: number; failed: number }> {
  const limit = opts.limit ?? 10000;
  const rows = await sqlFn`
    SELECT s.id, s.payload FROM submissions s
    WHERE s.payload->>'status' = 'confirmed'
      AND NOT EXISTS (SELECT 1 FROM record_facts f WHERE f.submission_id = s.id)
    ORDER BY s.id
    LIMIT ${limit}
  `.catch(() => []);
  if (!rows.length) return { materialized: 0, failed: 0 };

  const rawSql = sqlFn as unknown as (text: string, params: unknown[]) => Promise<unknown[]>;
  const BATCH = 200;
  const COLS = 9; // submission_id, survey_key, submitted_by, district, constituency, filterable_answers, geo, confirmed_at, fact_status
  let materialized = 0;
  const failedIds: number[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = (rows as { id: number; payload: unknown }[]).slice(i, i + BATCH);
    const valueRows: unknown[][] = [];
    for (const r of chunk) {
      try {
        const payload = parsePayload(r.payload);
        if (payloadStatus(payload) !== "confirmed") continue;
        const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
        // Guard against malformed confirmed_at poisoning the whole batch
        const confirmedAt = (() => {
          const ts = String(payload.confirmed_at || "");
          return ts && !Number.isNaN(Date.parse(ts)) ? ts : new Date().toISOString();
        })();
        valueRows.push([
          Number(r.id),
          String(payload.form_key || payload.formKey || "default"),
          surveyorNameOf(payload),
          String(answers.district || "").trim(),
          String(answers.constituency || "").trim(),
          JSON.stringify(buildFilterableAnswers(payload)),
          payload.geo ? JSON.stringify(payload.geo) : null,
          confirmedAt,
          "materialized",
        ]);
      } catch {
        failedIds.push(Number(r.id));
      }
    }
    if (!valueRows.length) continue;
    const placeholders = valueRows
      .map((_, r) =>
        `(${Array.from({ length: COLS }, (_, c) => `$${r * COLS + c + 1}`).join(", ")})`,
      )
      .join(", ");
    try {
      await rawSql(
        `INSERT INTO record_facts (submission_id, survey_key, submitted_by, district, constituency, filterable_answers, geo, confirmed_at, fact_status)
         VALUES ${placeholders}
         ON CONFLICT (submission_id) DO NOTHING`,
        valueRows.flat(),
      );
      materialized += valueRows.length;
      await sqlFn`UPDATE submissions SET fact_status = 'materialized', fact_error = NULL WHERE id = ANY(${valueRows.map((v) => v[0])})`.catch(() => null);
    } catch {
      for (const r of chunk) failedIds.push(Number(r.id));
    }
  }

  for (const id of failedIds) {
    await markFactFailed(sqlFn, id, new Error("fact backfill failed"));
  }
  return { materialized, failed: failedIds.length };
}

/**
 * BR-004 record-layer scope: the form_keys a Client Admin may read/write.
 * Owned projects + Super-Admin-assigned projects (survey_admin_access) +
 * the legacy & default forms, which stay visible to every portal admin so
 * existing data never disappears. Super Admin and surveyors are unrestricted.
 * Returns null = unrestricted, or the allowed form_key list.
 */
async function adminFormKeyScope(
  sqlFn: NonNullable<typeof sql>,
  me: { role: unknown; id: unknown } | null,
): Promise<string[] | null> {
  if (!me || me.role !== "admin") return null;
  const rows = await sqlFn`
    SELECT form_key FROM survey_form
    WHERE created_by = ${me.id}
       OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
       OR form_key IN ('legacy', 'default')
  `.catch(() => []);
  return [...new Set((rows as { form_key: string }[]).map((r) => String(r.form_key)))];
}

async function loadAnalyticsRows(
  sqlFn: NonNullable<typeof sql>,
  limit = 10000,
  scopeKeys: string[] | null = null,
): Promise<Row[]> {
  // AC name → first covering district (excel often puts AC in respondent_name)
  const acRows = await sqlFn`
    SELECT name, covering_districts, mp_constituency FROM assembly_constituencies
  `.catch(() => []);

  type AcEntry = { canonical: string; district: string; covering: string[]; mp: string };
  const acList: AcEntry[] = [];
  for (const ac of acRows as {
    name: string;
    covering_districts: string;
    mp_constituency: string;
  }[]) {
    const covering = String(ac.covering_districts || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    acList.push({
      canonical: String(ac.name || "").trim(),
      district: covering[0] || "",
      covering,
      mp: String(ac.mp_constituency || "").replace(/\s*\(.*?\)\s*$/, "").trim(),
    });
  }

  function softNameEq(a: string, b: string) {
    const n = (s: string) =>
      String(s || "")
        .toLowerCase()
        .replace(/\(([^)]*)\)/g, " $1 ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return n(a) === n(b);
  }

  /** One row → one district only (primary AC district). No multi-cover overlap. */
  function exclusiveDistrict(surveyDistrict: string, resolved: AcEntry | null) {
    const sd = String(surveyDistrict || "").trim();
    if (!resolved) return sd || "Unknown";
    const covering = resolved.covering || [];
    const primary = resolved.district || covering[0] || "";
    if (sd && covering.some((d) => softNameEq(d, sd))) {
      return covering.find((d) => softNameEq(d, sd)) || sd;
    }
    return primary || sd || "Unknown";
  }

  /** District spelling variants → canonical (Hanamkonda = 2022 name of Warangal Urban) */
  const DISTRICT_ALIAS: Record<string, string> = GEO_ALIASES.districts as Record<
    string,
    string
  >;
  const normKey = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/\(([^)]*)\)/g, " $1 ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** Edit distance — tolerant fuzzy name matching for any spelling variant */
  function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i, ...Array(n).fill(0)] as number[];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  /** Unique closest candidate by edit distance (ambiguous → null) */
  function closestName(key: string, candidates: string[]): string | null {
    if (!key || key.length < 5 || !candidates?.length) return null;
    const limit = Math.max(1, Math.floor(Math.max(key.length, 6) / 5));
    let best: string | null = null;
    let bestD = Infinity;
    let secondD = Infinity;
    for (const c of candidates) {
      const d = editDistance(key, c);
      if (d < bestD) {
        secondD = bestD;
        bestD = d;
        best = c;
      } else if (d < secondD) {
        secondD = d;
      }
    }
    if (!best || bestD > limit || bestD >= secondD) return null;
    return best;
  }

  function normDistrict(v: string): string {
    const raw = String(v || "").trim();
    const tel = TELUGU_ALIAS[raw] || TELUGU_ALIAS[raw.replace(/\s+/g, " ")];
    if (tel) return tel;
    const key = normKey(raw);
    if (!key) return v;
    const hit = DISTRICT_ALIAS[key];
    if (hit) return hit;
    const close = closestName(
      key,
      (GEO_ALIASES.districtNames as string[]) || [],
    );
    return close || v;
  }

  /** AC spelling variants → canonical AC name (fixes old/unofficial Excel labels) */
  const AC_ALIAS: Record<string, string> = GEO_ALIASES.acs as Record<
    string,
    string
  >;

  function resolveAc(name: string): AcEntry | null {
    if (!name?.trim()) return null;
    const key = name
      .toLowerCase()
      .replace(/\(([^)]*)\)/g, " $1 ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return null;
    // Known spelling variants first (deterministic, before fuzzy scan)
    const aliased = AC_ALIAS[key];
    if (aliased) {
      const hit = acList.find((ac) => normKey(ac.canonical) === normKey(aliased));
      if (hit) return hit;
    }
    // exact-ish
    for (const ac of acList) {
      const n = ac.canonical
        .toLowerCase()
        .replace(/\(([^)]*)\)/g, " $1 ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (n === key) return ac;
    }
    // Safe fuzzy: longest unique match only (no ambiguous cross-AC hits)
    if (key.length < 5) return null;
    let best: AcEntry | null = null;
    let bestLen = 0;
    let ties = 0;
    for (const ac of acList) {
      const n = ac.canonical
        .toLowerCase()
        .replace(/\(([^)]*)\)/g, " $1 ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!n || n.length < 5) continue;
      const hit =
        n === key ||
        (n.includes(key) && key.length >= 5) ||
        (key.includes(n) && n.length >= 5);
      if (!hit) continue;
      const score = Math.min(n.length, key.length);
      if (score > bestLen) {
        best = ac;
        bestLen = score;
        ties = 1;
      } else if (score === bestLen && best && best.canonical !== ac.canonical) {
        ties += 1;
      }
    }
    if (ties > 1) return null;
    if (best) return best;
    // Last resort: unique edit-distance match (handles any misspelling)
    const near = closestName(key, acList.map((ac) => normKey(ac.canonical)));
    if (near) return acList.find((ac) => normKey(ac.canonical) === near) || null;
    return null;
  }

  // Mandal name → district (auto district when AC is unknown)
  const mandalRows = await sqlFn`
    SELECT mandal_name, district FROM mandals LIMIT 30000
  `.catch(() => []);
  const mandalLookup = new Map<string, string>();
  for (const m of mandalRows as { mandal_name?: string; district?: string }[]) {
    const k = normKey(String(m.mandal_name || ""));
    const d = String(m.district || "").trim();
    if (k && d && !mandalLookup.has(k)) mandalLookup.set(k, d);
  }

  // BR-004: Client Admin scope = own/assigned projects' form_keys (null = unrestricted).
  const raw = scopeKeys
    ? await sqlFn`
        SELECT id, payload, created_at
        FROM submissions
        WHERE payload->>'form_key' = ANY(${scopeKeys})
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sqlFn`
        SELECT id, payload, created_at
        FROM submissions
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

  // Must load media — empty kinds made field surveys with only survey_media look incomplete
  const mediaMap = await loadMediaKindsMap(sqlFn);

  const allRows: Row[] = (raw as Record<string, unknown>[]).map((row) => {
    let payload = row.payload as Record<string, unknown>;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    const a = (payload?.answers as Record<string, unknown>) || payload || {};
    let dist = String(a.district || "").trim();
    let ac = String(a.constituency || a.assembly_constituency || "").trim();
    const respondent = String(a.respondent_name || a.respondentName || "").trim();
    const mandal = String(a.mandal || "").trim();

    // Resolve AC — exclusive single district (primary only, no multi-cover overlap)
    let resolved = resolveAc(ac) || resolveAc(respondent);
    if (resolved) {
      ac = resolved.canonical;
      dist = exclusiveDistrict(normDistrict(dist), resolved);
    } else {
      // No AC match → fall back to mandal → district (mandals table) when district missing
      if (!dist) {
        const md = mandalLookup.get(normKey(mandal));
        if (md) dist = md;
      }
      dist = normDistrict(dist);
    }

    let issues = a.issues as string[] | string;
    if (typeof issues === "string") {
      issues = issues.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(issues)) issues = [];

    const status = payloadStatus(payload);
    const verify = verifyWithMedia(payload, mediaMap, Number(row.id));
    const surveyor = surveyorNameOf(payload);
    return {
      id: row.id as string | number,
      created_at: isoStamp(row.created_at),
      district: dist || "Unknown",
      constituency: ac || "Unknown",
      mandal: mandal || "",
      lat: String(
        a.latitude || a.lat || a.geo_lat ||
          (payload.geo as Record<string, unknown> | undefined)?.lat ||
          payload.latitude || payload.lat || "",
      ),
      lng: String(
        a.longitude || a.lng || a.geo_lng ||
          (payload.geo as Record<string, unknown> | undefined)?.lng ||
          payload.longitude || payload.lng || "",
      ),
      party: normParty(String(a.winning_party || a.winningParty || "")),
      gender: normGender(String(a.gender || "")),
      caste: normCaste(String(a.caste || "")),
      pm: normPm(String(a.pm_preference || a.pmPreference || "")),
      performance: String(a.performance || a.govt_performance || "Unknown") || "Unknown",
      education: String(a.education || "Unknown") || "Unknown",
      employment: String(a.employment || a.occupation || "Unknown") || "Unknown",
      age: String(a.age || a.age_group || "Unknown") || "Unknown",
      mp: String(a.mp_constituency || a.mpConstituency || "")
        .replace(/\s*\(.*?\)\s*$/, "")
        .trim() || resolved?.mp || "",
      issues: issues as string[],
      status,
      completeness: verify.completeness,
      geo_ok: verify.geo_ok,
      voice_ok: verify.voice_ok,
      submitted_by: surveyor === "unknown" ? "" : surveyor,
      respondent: respondent || String(a.respondent_name || ""),
      formKey: String(payload.form_key || payload.formKey || "default"),
      answers: a,
    };
  });
  return allRows;
}

async function buildAnalytics(
  sqlFn: NonNullable<typeof sql>,
  url: URL,
  scopeKeys: string[] | null = null,
) {
  const district = (url.searchParams.get("district") || "").trim();
  const party = (url.searchParams.get("party") || "").trim();
  const gender = (url.searchParams.get("gender") || "").trim();
  const caste = (url.searchParams.get("caste") || "").trim();
  const constituency = (url.searchParams.get("constituency") || "").trim();
  // Report pipeline: default analytics = confirmed only
  // report=locked → Client Admin dashboard: force confirmed + complete (no raw/pending charts)
  const reportLocked = (url.searchParams.get("report") || "").trim().toLowerCase() === "locked";
  let statusFilter = (url.searchParams.get("status") || "confirmed").trim().toLowerCase();
  let completenessFilter = (url.searchParams.get("completeness") || "all").trim().toLowerCase();
  if (reportLocked) {
    statusFilter = "confirmed";
    completenessFilter = "complete";
  }
  let dateFrom = (url.searchParams.get("date_from") || url.searchParams.get("from") || "").trim();
  let dateTo = (url.searchParams.get("date_to") || url.searchParams.get("to") || "").trim();
  const userFilter = (url.searchParams.get("user") || url.searchParams.get("submitted_by") || "").trim();
  const formFilter = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
  // period: total | day | month | today — Client Admin data scopes
  const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
  const dayParam = (url.searchParams.get("day") || "").trim(); // YYYY-MM-DD
  const monthParam = (url.searchParams.get("month") || "").trim(); // YYYY-MM
  if (period === "today") {
    const t = new Date().toISOString().slice(0, 10);
    dateFrom = t;
    dateTo = t;
  } else if (period === "day" && dayParam) {
    dateFrom = dayParam;
    dateTo = dayParam;
  } else if (period === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    if (y && m) {
      const last = new Date(y, m, 0).getDate();
      dateFrom = `${monthParam}-01`;
      dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
    }
  }
  // period=total → leave dateFrom/dateTo as provided (or empty = all time)

  const allRows = await loadAnalyticsRows(sqlFn, 10000, scopeKeys);

  const statusCounts = {
    pending: allRows.filter((r) => r.status === "pending").length,
    confirmed: allRows.filter((r) => r.status === "confirmed").length,
    rejected: allRows.filter((r) => r.status === "rejected").length,
    total: allRows.length,
  };

  // Analytics universe: confirmed report by default (after Q/A confirm)
  let universe = allRows;
  if (statusFilter === "confirmed") {
    universe = allRows.filter((r) => r.status === "confirmed");
  } else if (statusFilter === "pending") {
    universe = allRows.filter((r) => r.status === "pending");
  } else if (statusFilter === "rejected") {
    universe = allRows.filter((r) => r.status === "rejected");
  }
  // status=all → full universe

  // Client Admin: date + user scope before charts
  if (dateFrom) {
    universe = universe.filter((r) => dayKey(r.created_at) >= dateFrom);
  }
  if (dateTo) {
    universe = universe.filter((r) => dayKey(r.created_at) <= dateTo);
  }
  if (userFilter) {
    const uf = userFilter.toLowerCase();
    universe = universe.filter((r) =>
      String(r.submitted_by || "").toLowerCase().includes(uf)
    );
  }
  if (formFilter) {
    universe = universe.filter((r) =>
      String(r.formKey || "") === formFilter
    );
  }

  // Survey questions → dynamic filter bar (options from defined choices + submitted answers)
  const surveyQuestions: { id: string; label: string; type: string; options: string[] }[] = [];
  {
    // Selected survey → its questions only; otherwise union of ALL surveys' questions,
    // so filters/charts follow the Client Admin's question naming everywhere.
    const formRows = formFilter
      ? await sqlFn`
          SELECT questions FROM survey_form WHERE form_key = ${formFilter} LIMIT 1
        `.catch(() => [])
      : await sqlFn`SELECT questions FROM survey_form`.catch(() => []);
    const seen = new Set<string>();
    for (const frow of formRows as { questions?: unknown }[]) {
      let qs = frow?.questions;
      if (typeof qs === "string") {
        try { qs = JSON.parse(qs); } catch { qs = []; }
      }
      if (!Array.isArray(qs)) continue;
      for (const q of qs as Record<string, unknown>[]) {
        const id = String(q.id || q.label || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const type = String(q.type || "text");
        const defined = Array.isArray(q.options) ? q.options.map(String) : [];
        const opts = type === "age" ? [...AGE_OPTIONS] : [...defined];
        if (type === "text" || !opts.length) {
          const seenVals = new Set<string>(opts);
          for (const r of universe) {
            const av = answerOf(r.answers, id, String(q.label || ""));
            const vals = Array.isArray(av) ? av.map(String) : [String(av ?? "")];
            for (const v of vals) if (v && v !== "Unknown" && v !== "undefined") seenVals.add(v);
          }
          opts.push(...seenVals);
        }
        surveyQuestions.push({
          id,
          label: String(q.label || id),
          type,
          options: [...new Set(opts)].slice(0, 100),
        });
      }
    }
  }

  // Dynamic filters: q_<questionId>=value (driven by survey questions)
  const dynFilters = new Map<string, string>();
  for (const [k, v] of url.searchParams) {
    if (k.startsWith("q_") && v) dynFilters.set(k.slice(2), v);
  }
  if (dynFilters.size) {
    universe = universe.filter((r) => {
      for (const [qid, want] of dynFilters) {
        const q = surveyQuestions.find((sq) => sq.id === qid);
        const av = answerOf(r.answers, qid, q?.label);
        const hit = q?.type === "age"
          ? ageBucket(av) === want
          : Array.isArray(av)
            ? av.map(String).includes(want)
            : String(av ?? "") === want;
        if (!hit) return false;
      }
      return true;
    });
  }

  // Survey titles for the by_survey board (participants + locations per survey)
  const surveyTitles = new Map<string, string>();
  {
    const trows = await sqlFn`SELECT form_key, title FROM survey_form`.catch(() => []);
    for (const t of trows as { form_key?: string; title?: string }[]) {
      surveyTitles.set(String(t.form_key || ""), String(t.title || ""));
    }
  }
  if (completenessFilter === "complete") {
    universe = universe.filter((r) => r.completeness === "complete");
  } else if (completenessFilter === "incomplete") {
    universe = universe.filter((r) => r.completeness === "incomplete");
  }

  const totalAll = universe.length;
  const filterOptions = {
    districts: [...new Set(universe.map((r) => r.district).filter((d) => d && d !== "Unknown"))].sort(),
    parties: [...new Set(universe.map((r) => r.party))].sort(),
    genders: [...new Set(universe.map((r) => r.gender))].sort(),
    castes: [...new Set(universe.map((r) => r.caste))].sort(),
    constituencies: [
      ...new Set(universe.map((r) => r.constituency).filter((c) => c && c !== "Unknown")),
    ]
      .sort()
      .slice(0, 200),
    statuses: ["confirmed", "pending", "rejected", "all"],
    users: [...new Set(universe.map((r) => r.submitted_by).filter(Boolean))].sort().slice(0, 200),
    completeness: ["complete", "incomplete", "all"],
  };

  let subset = universe;
  if (district) subset = subset.filter((r) => softEq(r.district, district));
  if (party) subset = subset.filter((r) => r.party === party);
  if (gender) subset = subset.filter((r) => r.gender === gender);
  if (caste) subset = subset.filter((r) => r.caste === caste);
  if (constituency) subset = subset.filter((r) => softEq(r.constituency, constituency));

  const isFiltered = subset.length < universe.length;
  const subsetIds = new Set(subset.map((r) => r.id));
  const restRows = universe.filter((r) => !subsetIds.has(r.id));
  const rows = subset;

  const countKey = (list: Row[], key: keyof Row) =>
    withPct(
      countBy(
        list.map((r) => ({ key: String(r[key]) })),
        (r) => r.key,
      ),
    );

  const byParty = countKey(rows, "party");
  // ALL districts with data for maps (no artificial top-N cut that hides small districts)
  const byDistrictRaw = countBy(
    rows.map((r) => ({ key: r.district })),
    (r) => r.key,
  );
  const byDistrict = withPct(
    byDistrictRaw.filter((d) => d.name !== "Unknown"),
  );
  const byGender = countKey(rows, "gender");
  const byCaste = countKey(rows, "caste");
  const byPm = countKey(rows, "pm");
  const byPerformance = countKey(rows, "performance").slice(0, 10);
  const byEducation = countKey(rows, "education").slice(0, 10);
  const byEmployment = countKey(rows, "employment").slice(0, 10);
  // Full AC list for assembly map coloring (not just top 12)
  const byConstituency = withPct(
    countBy(
      rows.filter((r) => r.constituency !== "Unknown").map((r) => ({ key: r.constituency })),
      (r) => r.key,
    ),
  );
  const byAge = countKey(rows, "age");
  const byMp = withPct(
    countBy(
      rows.filter((r) => r.mp).map((r) => ({ key: r.mp })),
      (r) => r.key,
    ),
  );

  const issueMap = new Map<string, number>();
  for (const r of rows) {
    for (const iss of r.issues) {
      const name = String(iss).trim();
      if (!name) continue;
      issueMap.set(name, (issueMap.get(name) || 0) + 1);
    }
  }
  const issues = withPct(
    [...issueMap.entries()]
      .map(([name, value]) => ({ name, value, pct: 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
  );

  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const day = (r.created_at || "").slice(0, 10);
    if (!day) continue;
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const timeline = [...dayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60);

  // Per-question distribution charts — report forms from the Client Admin's
  // question naming (every survey, or the selected survey only).
  const questionCharts = surveyQuestions
    .map((q) => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const av = answerOf(r.answers, q.id, q.label);
        const vals = Array.isArray(av) ? av.map(String) : [String(av ?? "")];
        for (const v of vals) {
          const name = q.type === "age" ? ageBucket(v) : String(v).trim();
          if (!name || name === "Unknown" || name === "undefined") continue;
          map.set(name, (map.get(name) || 0) + 1);
        }
      }
      return {
        id: q.id,
        label: q.label,
        type: q.type,
        counts: withPct(
          [...map.entries()]
            .map(([name, value]) => ({ name, value, pct: 0 }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 12),
        ),
      };
    })
    .filter((q) => q.counts.length > 0);

  // Cross-tabs for maps
  const partyOrder = ["Congress", "BJP", "BRS", "Others", "Undecided"];
  function crossTab(list: Row[], rowKey: keyof Row, colKey: keyof Row) {
    const rowMap = new Map<string, Record<string, number | string>>();
    for (const r of list) {
      const rk = String(r[rowKey] || "Unknown");
      const ck = String(r[colKey] || "Unknown");
      if (!rowMap.has(rk)) rowMap.set(rk, { name: rk, total: 0 });
      const row = rowMap.get(rk)!;
      row[ck] = Number(row[ck] || 0) + 1;
      row.total = Number(row.total || 0) + 1;
    }
    const columns = partyOrder;
    const outRows = [...rowMap.values()]
      .map((r) => {
        for (const c of columns) if (r[c] == null) r[c] = 0;
        return r;
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
    return { columns, rows: outRows };
  }

  const partyByDistrict = crossTab(rows, "district", "party");
  const partyByDistrictChart = {
    columns: partyByDistrict.columns,
    rows: partyByDistrict.rows.slice(0, 12),
  };
  const partyByCaste = crossTab(rows, "caste", "party");
  const partyByGender = crossTab(rows, "gender", "party");
  const partyByConstituency = crossTab(
    rows.filter((r) => r.constituency !== "Unknown"),
    "constituency",
    "party",
  );
  const partyByMp = crossTab(
    rows.filter((r) => r.mp),
    "mp",
    "party",
  );

  const contrastParty = isFiltered
    ? compareSets(pctDist(subset, "party"), pctDist(restRows, "party"), pctDist(universe, "party"))
    : [];
  const contrastGender = isFiltered
    ? compareSets(pctDist(subset, "gender"), pctDist(restRows, "gender"), pctDist(universe, "gender"))
    : [];
  const contrastCaste = isFiltered
    ? compareSets(pctDist(subset, "caste"), pctDist(restRows, "caste"), pctDist(universe, "caste"))
    : [];
  const contrastPm = isFiltered
    ? compareSets(pctDist(subset, "pm"), pctDist(restRows, "pm"), pctDist(universe, "pm"))
    : [];
  const contrastConstituency = isFiltered
    ? compareSets(
        pctDist(subset.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
        pctDist(restRows.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
        pctDist(universe.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
      ).slice(0, 25)
    : [];
  const contrastDistrict = isFiltered
    ? compareSets(
        pctDist(subset.filter((r) => r.district && r.district !== "Unknown"), "district"),
        pctDist(restRows.filter((r) => r.district && r.district !== "Unknown"), "district"),
        pctDist(universe.filter((r) => r.district && r.district !== "Unknown"), "district"),
      )
    : [];
  const contrastMp = isFiltered
    ? compareSets(
        pctDist(subset.filter((r) => r.mp), "mp"),
        pctDist(restRows.filter((r) => r.mp), "mp"),
        pctDist(universe.filter((r) => r.mp), "mp"),
      )
    : [];

  const topParty = byParty[0];
  const topIssue = issues[0];
  const topDistrict = byDistrict[0];

  return {
    totalAll,
    filtered: rows.length,
    restCount: restRows.length,
    isFiltered,
    reportStatus: statusFilter,
    reportLocked,
    statusCounts,
    completenessCounts: {
      complete: universe.filter((r) => r.completeness === "complete").length,
      incomplete: universe.filter((r) => r.completeness === "incomplete").length,
    },
    pipeline: {
      step: "1 Users → 2 Collect → 3 Verify geo+voice → 4 Client Admin confirms → 5 Report forms",
      analytics_on: statusFilter,
      note: reportLocked
        ? "Dashboard locked to confirmed + complete only. Unconfirmed data never forms charts."
        : statusFilter === "confirmed"
        ? "Report uses confirmed surveys. Strict geo + voice required for complete; legacy rows (no GPS/camera) are exempt."
        : `Analytics scope: ${statusFilter}`,
    },
    filters: {
      district,
      party,
      gender,
      caste,
      constituency,
      status: statusFilter,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      user: userFilter || null,
      survey: formFilter || null,
      completeness: completenessFilter,
      period,
      day: dayParam || null,
      month: monthParam || null,
    },
    // Client Admin summaries: daily / monthly / surveyor daily / surveyor monthly
    dataFilters: {
      period,
      total: universe.length,
      by_user: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const u = r.submitted_by || "unknown";
          map.set(u, (map.get(u) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({
            name,
            value,
            pct: universe.length
              ? Math.round((value / universe.length) * 1000) / 10
              : 0,
          }))
          .sort((a, b) => b.value - a.value);
      })(),
      by_day: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const d = dayKey(r.created_at) || "unknown";
          map.set(d, (map.get(d) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.name.localeCompare(a.name));
      })(),
      by_month: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const m = dayKey(r.created_at).slice(0, 7) || "unknown";
          map.set(m, (map.get(m) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.name.localeCompare(a.name));
      })(),
      // Surveyor × day (each surveyor's daily totals)
      by_surveyor_day: (() => {
        const map = new Map<string, { surveyor: string; day: string; value: number }>();
        for (const r of universe) {
          const surveyor = r.submitted_by || "unknown";
          const day = dayKey(r.created_at) || "unknown";
          const key = `${surveyor}::${day}`;
          const cur = map.get(key);
          if (cur) cur.value += 1;
          else map.set(key, { surveyor, day, value: 1 });
        }
        return [...map.values()].sort((a, b) => {
          const d = b.day.localeCompare(a.day);
          if (d !== 0) return d;
          return b.value - a.value || a.surveyor.localeCompare(b.surveyor);
        });
      })(),
      // Dynamic per-question filter dropdowns (from the selected survey)
      questions: surveyQuestions.map((q) => ({
        id: q.id,
        label: q.label,
        type: q.type,
        options: q.options,
        counts: (() => {
          const map = new Map<string, number>();
          for (const r of universe) {
            const av = answerOf(r.answers, q.id, q.label);
            const vals = Array.isArray(av) ? av.map(String) : [String(av ?? "")];
            for (const v of vals) {
              const name = q.type === "age" ? ageBucket(v) : v;
              if (!name || name === "Unknown") continue;
              map.set(name, (map.get(name) || 0) + 1);
            }
          }
          return [...map.entries()]
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 100);
        })(),
      })),
      // Surveyor × month (each surveyor's monthly totals)
      by_surveyor_month: (() => {
        const map = new Map<string, { surveyor: string; month: string; value: number }>();
        for (const r of universe) {
          const surveyor = r.submitted_by || "unknown";
          const month = dayKey(r.created_at).slice(0, 7) || "unknown";
          const key = `${surveyor}::${month}`;
          const cur = map.get(key);
          if (cur) cur.value += 1;
          else map.set(key, { surveyor, month, value: 1 });
        }
        return [...map.values()].sort((a, b) => {
          const m = b.month.localeCompare(a.month);
          if (m !== 0) return m;
          return b.value - a.value || a.surveyor.localeCompare(b.surveyor);
        });
      })(),
      // By survey: submissions, participating surveyors, locations covered
      by_survey: (() => {
        type SurveyStat = {
          name: string;
          title: string;
          value: number;
          surveyors: Set<string>;
          districts: Set<string>;
          constituencies: Set<string>;
        };
        const map = new Map<string, SurveyStat>();
        for (const r of universe) {
          const key = r.formKey || "default";
          let row = map.get(key);
          if (!row) {
            row = {
              name: key,
              title: surveyTitles.get(key) || key,
              value: 0,
              surveyors: new Set(),
              districts: new Set(),
              constituencies: new Set(),
            };
            map.set(key, row);
          }
          row.value += 1;
          if (r.submitted_by) row.surveyors.add(r.submitted_by);
          if (r.district && r.district !== "Unknown") row.districts.add(r.district);
          if (r.constituency && r.constituency !== "Unknown") {
            row.constituencies.add(r.constituency);
          }
        }
        return [...map.values()]
          .map((s) => ({
            name: s.name,
            title: s.title,
            value: s.value,
            surveyors: [...s.surveyors].sort(),
            districts: [...s.districts].sort(),
            constituencies: [...s.constituencies].sort(),
          }))
          .sort((a, b) => b.value - a.value);
      })(),
    },
    filterOptions,
    formula: {
      name: "Super-set / Sub-set",
      description:
        "Subset = filtered selection. Superset = confirmed (or selected status) surveys. Rest = Superset − Subset. Δpp = Subset% − Rest%. Index = Subset% / Superset%.",
      superset_n: totalAll,
      subset_n: subset.length,
      rest_n: restRows.length,
      is_filtered: isFiltered,
      equations: [
        "Subset% = count_in_subset / |subset| × 100",
        "Rest% = count_in_rest / |rest| × 100",
        "Δpp = Subset% − Rest%",
        "Index = Subset% / Superset%",
      ],
    },
    insights: {
      topParty: topParty
        ? `${topParty.name} leads with ${topParty.pct}% (${topParty.value})`
        : "No party data",
      topIssue: topIssue ? `Top issue: ${topIssue.name} (${topIssue.value})` : "No issues tagged",
      topDistrict: topDistrict
        ? `Most responses: ${topDistrict.name} (${topDistrict.value})`
        : "No district data",
      coverage: `${rows.length.toLocaleString()} of ${totalAll.toLocaleString()} records`,
      contrast:
        isFiltered && contrastParty[0]
          ? `Subset vs Rest: ${contrastParty[0].name} Δ ${
            contrastParty[0].delta > 0 ? "+" : ""
          }${contrastParty[0].delta}pp`
          : "Apply a filter to compare Subset vs Superset/Rest",
    },
    charts: {
      byParty,
      byDistrict,
      byGender,
      byCaste,
      byPm,
      byPerformance,
      byEducation,
      byEmployment,
      byConstituency,
      byAge,
      byMp,
      issues,
      timeline,
      questionCharts,
      partyByDistrict: partyByDistrictChart,
      partyByDistrictFull: partyByDistrict,
      partyByConstituency,
      partyByMp,
      partyByCaste,
      partyByGender,
      contrastParty,
      contrastGender,
      contrastCaste,
      contrastPm,
      contrastConstituency,
      contrastDistrict,
      contrastMp,
    },
  };
}

// ── Router ────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method;

  try {
    if (!sql) return json({ error: "DATABASE_URL not set" }, 500);
    await ready();

    // Health
    if (path === "/" || path === "/api/health") {
      const r2 = r2Config();
      const r2Status = {
        keys_configured: Boolean(r2.ak && r2.sk),
        public_url_configured: Boolean(r2.publicBase),
        ready: Boolean(r2.ak && r2.sk && r2.publicBase && r2.buck),
      };
      if (path === "/") {
        return json({
          message: "Election Survey API on Deno Deploy",
          platform: "deno",
          auth: true,
          r2: r2Status,
        });
      }
      return json({
        ok: true,
        database: "connected",
        auth: true,
        platform: "deno",
        r2: r2Status,
      });
    }

    // Login — admin portal OR surveyor field app (accounts created by Client Admin only)
    if (path === "/api/auth/login" && method === "POST") {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const expectedRole = String(body.expected_role || "").trim().toLowerCase();
      if (!username || !password) {
        return json({ error: "Username and password required" }, 400);
      }
      const rows = await sql`
        SELECT * FROM app_users WHERE LOWER(username) = ${username} LIMIT 1
      `;
      const user = rows[0] as {
        id: number;
        username: string;
        display_name: string;
        role: string;
        active: boolean;
        created_at: string;
        password_hash: string;
      } | undefined;
      if (!user || !user.active) {
        return json({
          error: "Invalid username or password. Use the login Client Admin created for you.",
        }, 401);
      }
      // Only admin/super_admin (portal) or surveyor (field app). No public signup / legacy field/user.
      if (user.role !== "super_admin" && user.role !== "admin" && user.role !== "surveyor") {
        return json({
          error:
            "Account not allowed. Ask Client Admin to create a surveyor login for the field app.",
        }, 403);
      }
      // Field app must send expected_role=surveyor — rejects admin & wrong roles
      if (expectedRole === "surveyor") {
        if (user.role !== "surveyor") {
          return json({
            error:
              user.role === "admin"
                ? "Client Admin uses the web portal (/admin), not the field app."
                : "This login is not a surveyor account. Ask Client Admin for a field-app login.",
          }, 403);
        }
      }
      // Portal must send expected_role=admin
      if (expectedRole === "admin") {
        if (user.role !== "admin" && user.role !== "super_admin") {
          return json({
            error:
              "Client Admin portal only. Surveyors sign in on the field app with their app login.",
          }, 403);
        }
      }
      // Super Admin console (separate GitHub page) — server-enforced super_admin only
      if (expectedRole === "super_admin") {
        if (user.role !== "super_admin") {
          return json({
            error: "Super Admin console only. Client Admin uses the main portal.",
          }, 403);
        }
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        return json({
          error: "Invalid username or password. Use the login Client Admin created for you.",
        }, 401);
      }

      const token = newToken();
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await sql`
        INSERT INTO app_sessions (token, user_id, expires_at)
        VALUES (${token}, ${user.id}, ${expires.toISOString()})
      `;
      logAudit(
        { id: user.id, username: user.username, role: user.role },
        "login",
        "user",
        user.id,
        { expected_role: expectedRole },
      );
      return json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.display_name || user.username,
          role: user.role,
          active: user.active,
          created_at: user.created_at,
          key_id: (user as Record<string, unknown>).key_id || null,
          phone: (user as Record<string, unknown>).phone || null,
          photo: (user as Record<string, unknown>).photo || null,
          aadhaar_front: (user as Record<string, unknown>).aadhaar_front || null,
          aadhaar_back: (user as Record<string, unknown>).aadhaar_back || null,
          verified: (user as Record<string, unknown>).verified === true,
          can_manage_questions: (user as Record<string, unknown>).can_manage_questions === true,
          can_edit_surveys: (user as Record<string, unknown>).can_edit_surveys === true,
          can_review_data: (user as Record<string, unknown>).can_review_data === true,
          can_verify_surveyors: (user as Record<string, unknown>).can_verify_surveyors === true,
          can_crud_questionnaire: (user as Record<string, unknown>).can_crud_questionnaire === true,
          can_validate_proof: (user as Record<string, unknown>).can_validate_proof === true,
          max_questions_per_survey: Number((user as Record<string, unknown>).max_questions_per_survey) || 0,
          max_surveys: Number((user as Record<string, unknown>).max_surveys) || 0,
          max_surveyors: Number((user as Record<string, unknown>).max_surveyors) || 0,
        },
        expires_at: expires.toISOString(),
        access:
          user.role === "surveyor"
            ? "surveyor_field_app"
            : user.role === "super_admin"
              ? "super_admin_portal"
              : "client_admin_portal",
        note:
          user.role === "surveyor"
            ? "Login created by Client Admin — field app only"
            : user.role === "super_admin"
              ? "Platform Super Admin — full access"
              : "Client Admin portal access",
      });
    }

    // Public registration disabled — only Client Admin creates accounts
    if (path === "/api/auth/register" && method === "POST") {
      return json({
        error:
          "No self-signup. Client Admin must create your surveyor login in the Users screen.",
      }, 403);
    }

    // Auth-required helpers
    const token = bearer(req);
    const me = await getUser(token);

    if (path === "/api/auth/me" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      return json({ user: me });
    }

    if (path === "/api/auth/logout" && method === "POST") {
      if (token) await sql`DELETE FROM app_sessions WHERE token = ${token}`;
      return json({ ok: true });
    }

    if (path === "/api/stats" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const statsScope = await adminFormKeyScope(sql, me);
      const [subs] = statsScope
        ? await sql`SELECT COUNT(*)::int AS n FROM submissions WHERE payload->>'form_key' = ANY(${statsScope})`
        : await sql`SELECT COUNT(*)::int AS n FROM submissions`;
      const [dists] = await sql`SELECT COUNT(*)::int AS n FROM districts`.catch(() => [{ n: 0 }]);
      const [mands] = await sql`SELECT COUNT(*)::int AS n FROM mandals`.catch(() => [{ n: 0 }]);
      const [acs] = await sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`.catch(() => [{ n: 0 }]);
      const [srs] = await sql`SELECT COUNT(*)::int AS n FROM survey_responses`.catch(() => [{ n: 0 }]);

      // Primary KPIs = survey coverage (same as maps/filters), not full master geo tables
      let surveyDistricts = 0;
      let surveyAcs = 0;
      try {
        const emptyUrl = new URL("http://local/api/analytics?status=all");
        const analytics = await buildAnalytics(sql, emptyUrl, statsScope);
        surveyDistricts = analytics.filterOptions?.districts?.length ?? 0;
        surveyAcs = analytics.filterOptions?.constituencies?.length ?? 0;
      } catch {
        // fall back to 0 if analytics fails
      }

      // Pipeline counts (pending / confirmed)
      let pending = 0;
      let confirmed = 0;
      let rejected = 0;
      try {
        const sample = statsScope
          ? await sql`
              SELECT payload FROM submissions
              WHERE payload->>'form_key' = ANY(${statsScope})
              ORDER BY created_at DESC LIMIT 10000
            `
          : await sql`
              SELECT payload FROM submissions ORDER BY created_at DESC LIMIT 10000
            `;
        for (const r of sample as { payload: Record<string, unknown> }[]) {
          let p = r.payload;
          if (typeof p === "string") {
            try {
              p = JSON.parse(p);
            } catch {
              p = {};
            }
          }
          const st = payloadStatus(p as Record<string, unknown>);
          if (st === "confirmed") confirmed += 1;
          else if (st === "rejected") rejected += 1;
          else pending += 1;
        }
      } catch {
        /* ignore */
      }

      return json({
        submissions: subs?.n ?? 0,
        survey_responses: srs?.n ?? 0,
        pending,
        confirmed,
        rejected,
        // Survey coverage from confirmed analytics universe
        districts: surveyDistricts,
        assembly_constituencies: surveyAcs,
        districts_master: dists?.n ?? 0,
        mandals: mands?.n ?? 0,
        assembly_constituencies_master: acs?.n ?? 0,
        my_submissions: 0,
        role: me.role,
        platform: "deno",
        pipeline: "users → Q/A → confirm → analytics",
      });
    }

    // Count completed records for one surveyor (by user_id or username/name)
    async function countDoneForUser(u: {
      id: number;
      username: string;
      name?: string;
      display_name?: string;
    }) {
      if (!sql) return 0;
      const uid = String(u.id);
      const uname = u.username;
      const dname = u.name || u.display_name || uname;
      const rows = await sql`
        SELECT COUNT(*)::int AS n FROM submissions
        WHERE payload->>'user_id' = ${uid}
           OR payload->>'submitted_by' = ${uname}
           OR payload->>'submitted_by' = ${dname}
           OR payload->'answers'->>'data_collector' = ${uname}
           OR payload->'answers'->>'data_collector' = ${dname}
      `.catch(() => [{ n: 0 }]);
      return rows[0]?.n ?? 0;
    }

    function progressStatus(done: number, target: number) {
      if (!target || target <= 0) {
        return done > 0 ? "in_progress" : "no_target";
      }
      if (done >= target) return "completed";
      if (done > 0) return "in_progress";
      return "not_started";
    }

    // ── Progress: surveyor self + admin board ───────────────
    if (path === "/api/progress/me" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const rows = await sql`
        SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota
        FROM app_users WHERE id = ${me.id} LIMIT 1
      `.catch(async () => {
        // column missing fallback
        const r = await sql`
          SELECT id, username, display_name, role, active FROM app_users WHERE id = ${me.id} LIMIT 1
        `;
        return r.map((x: Record<string, unknown>) => ({ ...x, target_quota: 0 }));
      });
      const u = rows[0] as {
        id: number;
        username: string;
        display_name: string;
        target_quota: number;
      };
      if (!u) return json({ error: "User not found" }, 404);
      const done = await countDoneForUser({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
      });
      const target = Number(u.target_quota) || 0;
      const remaining = target > 0 ? Math.max(0, target - done) : null;
      const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null;
      const status = progressStatus(done, target);
      return json({
        user_id: u.id,
        username: u.username,
        name: u.display_name || u.username,
        target,
        done,
        remaining,
        pct,
        status,
        next_record: target > 0 ? Math.min(done + 1, target) : done + 1,
        complete: status === "completed",
        label:
          target > 0
            ? `${done} / ${target} records · ${status}`
            : `${done} records (no target set)`,
      });
    }

    if (path === "/api/progress" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const rows = await sql`
        SELECT id, username, display_name, role, active, COALESCE(target_quota, 0) AS target_quota, created_at
        FROM app_users
        WHERE role IN ('surveyor', 'field')
        ORDER BY id
      `.catch(async () => {
        const r = await sql`
          SELECT id, username, display_name, role, active, created_at
          FROM app_users WHERE role IN ('surveyor', 'field') ORDER BY id
        `;
        return r.map((x: Record<string, unknown>) => ({ ...x, target_quota: 0 }));
      });
      const surveyors = [];
      for (const r of rows as {
        id: number;
        username: string;
        display_name: string;
        active: boolean;
        target_quota: number;
        created_at: string;
      }[]) {
        const done = await countDoneForUser(r);
        const target = Number(r.target_quota) || 0;
        const status = progressStatus(done, target);
        surveyors.push({
          id: r.id,
          username: r.username,
          name: r.display_name || r.username,
          active: r.active,
          target,
          done,
          remaining: target > 0 ? Math.max(0, target - done) : null,
          pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null,
          status,
          label:
            target > 0
              ? `${done}/${target}`
              : `${done}/—`,
          created_at: r.created_at,
        });
      }
      const totals = {
        surveyors: surveyors.length,
        targets: surveyors.reduce((s, x) => s + (x.target || 0), 0),
        done: surveyors.reduce((s, x) => s + x.done, 0),
        completed_users: surveyors.filter((x) => x.status === "completed").length,
        in_progress: surveyors.filter((x) => x.status === "in_progress").length,
      };
      return json({ surveyors, totals });
    }

    // Admin sets quota for one or all surveyors
    if (path === "/api/progress/quota" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const target = Math.max(0, Math.min(Number(body.target) || 0, 100000));
      if (body.user_id) {
        await sql`
          UPDATE app_users SET target_quota = ${target} WHERE id = ${Number(body.user_id)}
        `;
        return json({ ok: true, user_id: Number(body.user_id), target });
      }
      if (body.all_surveyors) {
        await sql`
          UPDATE app_users SET target_quota = ${target} WHERE role = 'surveyor'
        `;
        return json({ ok: true, all_surveyors: true, target });
      }
      return json({ error: "Provide user_id or all_surveyors:true" }, 400);
    }

    // ── Users: list / generate (admin) ───────────────────────
    if (path === "/api/users" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const assignedRows = await sql`
        SELECT sa.user_id, f.id AS survey_id, f.title, f.form_key
        FROM survey_assignments sa JOIN survey_form f ON f.id = sa.survey_id
        ORDER BY f.title
      `.catch(() => []);
      const assignedMap = new Map<number, { id: number; title: string; form_key: string }[]>();
      for (const a of assignedRows as {
        user_id: number;
        survey_id: number;
        title: string;
        form_key: string;
      }[]) {
        const arr = assignedMap.get(Number(a.user_id)) || [];
        arr.push({ id: Number(a.survey_id), title: a.title, form_key: a.form_key });
        assignedMap.set(Number(a.user_id), arr);
      }
      // BR-004 tenant scoping: a Client Admin only sees themselves + surveyors they
      // created (created_by = me.id). Super Admin sees every account. This stops
      // survey names/surveyors from being mixed across client admins.
      // NOTE: two explicit queries — the Deno-deployed neon driver rejects nested
      // composed ${...} sql fragments with 'syntax error at or near $1'.
      const rows = me.role === "super_admin"
        ? await sql`
            SELECT id, username, display_name, company_name, role, active, created_at,
                   COALESCE(target_quota, 0) AS target_quota,
                   key_id, phone, photo, aadhaar_front, aadhaar_back,
                   COALESCE(verified, FALSE) AS verified,
                   COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
                   COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
                   COALESCE(can_review_data, FALSE) AS can_review_data,
                   COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
                   COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
                   COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
                   COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
                   COALESCE(max_surveys, 0) AS max_surveys,
                   COALESCE(max_surveyors, 0) AS max_surveyors
            FROM app_users
            ORDER BY id
          `.catch(async () =>
            await sql`
              SELECT id, username, display_name, NULL::TEXT AS company_name, role, active, created_at,
                     FALSE AS can_manage_questions, FALSE AS can_edit_surveys,
                     FALSE AS can_review_data, FALSE AS can_verify_surveyors,
                     FALSE AS can_crud_questionnaire, FALSE AS can_validate_proof,
                     0 AS max_questions_per_survey, 0 AS max_surveys, 0 AS max_surveyors
              FROM app_users ORDER BY id
            `
          )
        : await sql`
            SELECT id, username, display_name, company_name, role, active, created_at,
                   COALESCE(target_quota, 0) AS target_quota,
                   key_id, phone, photo, aadhaar_front, aadhaar_back,
                   COALESCE(verified, FALSE) AS verified,
                   COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
                   COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
                   COALESCE(can_review_data, FALSE) AS can_review_data,
                   COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
                   COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
                   COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
                   COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
                   COALESCE(max_surveys, 0) AS max_surveys,
                   COALESCE(max_surveyors, 0) AS max_surveyors
            FROM app_users
            WHERE (id = ${me.id} OR created_by = ${me.id})
            ORDER BY id
          `.catch(async () =>
            await sql`
              SELECT id, username, display_name, NULL::TEXT AS company_name, role, active, created_at,
                     FALSE AS can_manage_questions, FALSE AS can_edit_surveys,
                     FALSE AS can_review_data, FALSE AS can_verify_surveyors,
                     FALSE AS can_crud_questionnaire, FALSE AS can_validate_proof,
                     0 AS max_questions_per_survey, 0 AS max_surveys, 0 AS max_surveyors
              FROM app_users
              WHERE (id = ${me.id} OR created_by = ${me.id})
              ORDER BY id
            `
          );
      const users = [];
      for (const r of rows as Record<string, unknown>[]) {
        let done = 0;
        if (r.role === "surveyor" || r.role === "field") {
          done = await countDoneForUser({
            id: Number(r.id),
            username: String(r.username),
            display_name: String(r.display_name || r.username),
          });
        }
        const target = Number(r.target_quota) || 0;
        const isCollector = r.role === "surveyor" || r.role === "field";
        // Usage vs allocated caps (Super Admin console → Client Admins tab)
        let survey_count = 0;
        let surveyor_count = 0;
        let surveyor_record_count = 0;
        let question_count = 0;
        let survey_team: { id: number; title: string; surveyors: { id: number; username: string; name: string }[] }[] = [];
        if (r.role === "admin") {
          const [sCnt] = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${Number(r.id)}`.catch(() => [{ n: 0 }]);
          survey_count = Number((sCnt as { n?: unknown }[])[0]?.n ?? 0);
          const [srCnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${Number(r.id)}`.catch(() => [{ n: 0 }]);
          surveyor_count = Number((srCnt as { n?: unknown }[])[0]?.n ?? 0);
          const [recordCnt] = await sql`
            SELECT COUNT(*)::int AS n
            FROM submissions s JOIN app_users u ON (
              s.payload->>'submitted_by' = u.username
              OR s.payload->>'submitted_by' = COALESCE(u.display_name, u.username)
            )
            WHERE u.role = 'surveyor' AND u.created_by = ${Number(r.id)}
          `.catch(() => [{ n: 0 }]);
          surveyor_record_count = Number((recordCnt as { n?: unknown }[])[0]?.n ?? 0);
          const [qCnt] = await sql`SELECT COALESCE(SUM(jsonb_array_length(questions)), 0)::int AS n FROM survey_form WHERE created_by = ${Number(r.id)}`.catch(() => [{ n: 0 }]);
          question_count = Number((qCnt as { n?: unknown }[])[0]?.n ?? 0);
          // Survey → surveyor mapping for this admin (only their own surveys + own surveyors)
          const teamRows = await sql`
            SELECT f.id AS sid, f.title,
                   COALESCE(array_agg(jsonb_build_object('id', u.id, 'username', u.username, 'name', COALESCE(u.display_name, u.username)))
                     FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS surveyors
            FROM survey_form f
            LEFT JOIN survey_assignments a ON a.survey_id = f.id
            LEFT JOIN app_users u ON u.id = a.user_id AND (u.created_by = ${Number(r.id)} OR u.role = 'admin' OR u.role = 'super_admin')
            WHERE f.created_by = ${Number(r.id)}
            GROUP BY f.id, f.title ORDER BY f.title
          `.catch(() => []);
          survey_team = (teamRows as { sid: number; title: string; surveyors: unknown }[]).map((t) => ({
            id: Number(t.sid),
            title: String(t.title),
            surveyors: Array.isArray(t.surveyors)
              ? (t.surveyors as { id: number; username: string; name: string }[])
              : [],
          }));
        }
        users.push({
          id: r.id,
          username: r.username,
          name: r.display_name || r.username,
          company_name: r.company_name || null,
          role: r.role,
          active: r.active,
          created_at: r.created_at,
          target_quota: target,
          survey_count,
          surveyor_count,
          surveyor_record_count,
          question_count,
          survey_team,
          // Projects explicitly assigned by Super Admin to this Client Admin.
          granted_surveys: r.role === "admin"
            ? (await sql`
                SELECT f.id, f.title
                FROM survey_admin_access saa JOIN survey_form f ON f.id = saa.survey_id
                WHERE saa.admin_id = ${Number(r.id)} ORDER BY f.title
              `.catch(() => []) as { id: number; title: string }[]).map((project) => ({
                id: Number(project.id), title: String(project.title),
              }))
            : [],
          done,
          key_id: r.key_id || null,
          phone: r.phone || null,
          photo: r.photo || null,
          aadhaar_front: r.aadhaar_front || null,
          aadhaar_back: r.aadhaar_back || null,
          verified: r.verified === true,
          can_manage_questions: r.can_manage_questions === true,
          can_edit_surveys: r.can_edit_surveys === true,
          can_review_data: r.can_review_data === true,
          can_verify_surveyors: r.can_verify_surveyors === true,
          can_crud_questionnaire: r.can_crud_questionnaire === true,
          can_validate_proof: r.can_validate_proof === true,
          max_questions_per_survey: Number(r.max_questions_per_survey) || 0,
          max_surveys: Number(r.max_surveys) || 0,
          max_surveyors: Number(r.max_surveyors) || 0,
          surveys: assignedMap.get(Number(r.id)) || [],
          status: isCollector ? progressStatus(done, target) : "admin",
          progress_label: isCollector
            ? target > 0
              ? `${done}/${target}`
              : `${done}/—`
            : "—",
        });
      }
      return json({ users });
    }

    if (path === "/api/users" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const name = String(body.name || username).trim();
      const phone = String(body.phone || "").trim();
      const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
      // surveyor = field collector (can login field app); admin = portal only
      const role = body.role === "admin" ? "admin" : "surveyor";
      const companyName = role === "admin" ? String(body.company_name || "").trim().slice(0, 160) : "";
      if (!username || !password) {
        return json({ error: "username and password required" }, 400);
      }
      if (password.length < 4) {
        return json({ error: "Password min 4 characters" }, 400);
      }
      // BR-006: enforce the approved admin seat limit (Super Admin raises it via approval).
      // Super Admin is the approval authority and is not bound by the cap.
      if (role === "admin" && me.role !== "super_admin") {
        const [sl] = await sql`SELECT approved_limit FROM seat_limits WHERE seat_role = 'admin'`.catch(() => []);
        const limit = sl ? Number((sl as { approved_limit: unknown }).approved_limit) : 5;
        const [cnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin' AND active = TRUE`.catch(() => [{ n: 0 }]);
        const current = Number((cnt as { n?: unknown }[])[0]?.n ?? 0);
        if (current >= limit) {
          return json({
            error: `Admin seat limit (${limit}) reached — file a seat upgrade request; Super Admin approves it (BR-006)`,
          }, 403);
        }
      }
      // Ensure role check allows surveyor
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('super_admin', 'admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
      await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
        .catch(() => null);
      try {
        const password_hash = await hashPasswordAsync(password);
        const key_id = await uniqueUserKeyId();
        // Grant-based powers can be set at admin creation by the Super Admin (least privilege)
        const canSuper = role === "admin" && me.role === "super_admin";
        const canManageQuestions = canSuper && body.can_manage_questions === true;
        const canEditSurveys = canSuper && body.can_edit_surveys === true;
        const canReviewData = canSuper && body.can_review_data === true;
        const canVerifySurveyors = canSuper && body.can_verify_surveyors === true;
        const canCrudQuestionnaire = canSuper && body.can_crud_questionnaire === true;
        const canValidateProof = canSuper && body.can_validate_proof === true;
        const maxQuestionsPerSurvey = canSuper
          ? Math.max(0, Math.min(Number(body.max_questions_per_survey) || 0, 100000))
          : 0;      const maxSurveysCreate = canSuper
        ? Math.max(0, Math.min(Number(body.max_surveys) || 0, 100000))
        : 0;
      const maxSurveyorsCreate = canSuper
        ? Math.max(0, Math.min(Number(body.max_surveyors) || 0, 100000))
        : 0;
      // Surveyor cap: a Client Admin may only create surveyors up to the Super-Admin-set
      // max_surveyors (0 = unlimited). Ownership is tracked via created_by.
      if (role === "surveyor" && me.role !== "super_admin") {
        const cap = Number((me as Record<string, unknown>).max_surveyors) || 0;
        if (cap > 0) {
          const [sc] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
          const surveyorCount = Number((sc as { n?: unknown }[])[0]?.n ?? 0);
          if (surveyorCount >= cap) {
            return json({
              error: `Surveyor limit reached — max ${cap} surveyors (set by Super Admin). Delete a surveyor or ask Super Admin to raise the limit.`,
            }, 422);
          }
        }
      }
        let finalCompanyName = companyName || null;
        let companyId: number | null = null;
        if (role === "admin" && finalCompanyName && sql) {
          const comp = await ensureCompanyExists(sql, finalCompanyName, me.id);
          if (comp) {
            companyId = comp.id;
            finalCompanyName = comp.name;
          }
        }
        const inserted = await sql`
          INSERT INTO app_users (username, password_hash, display_name, company_name, company_id, role, target_quota, active, key_id, phone, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_crud_questionnaire, can_validate_proof, max_questions_per_survey, max_surveys, max_surveyors, created_by)
          VALUES (${username}, ${password_hash}, ${name}, ${finalCompanyName}, ${companyId}, ${role}, ${target_quota}, TRUE, ${key_id}, ${phone || null}, ${canManageQuestions}, ${canEditSurveys}, ${canReviewData}, ${canVerifySurveyors}, ${canCrudQuestionnaire}, ${canValidateProof}, ${maxQuestionsPerSurvey}, ${maxSurveysCreate}, ${maxSurveyorsCreate}, ${me.id})
          RETURNING id, username, display_name, company_name, company_id, role, active, created_at, target_quota, key_id, phone, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_crud_questionnaire, can_validate_proof, max_questions_per_survey, max_surveys, max_surveyors
        `;
        const u = inserted[0] as Record<string, unknown>;
        logAudit(me, "user_create", "user", u.id, {
          username: u.username,
          role,
          target_quota,
          can_manage_questions: canManageQuestions,
          can_edit_surveys: canEditSurveys,
          can_review_data: canReviewData,
          can_verify_surveyors: canVerifySurveyors,
          can_crud_questionnaire: canCrudQuestionnaire,
          can_validate_proof: canValidateProof,
          max_questions_per_survey: maxQuestionsPerSurvey,
          max_surveys: maxSurveysCreate,
          max_surveyors: maxSurveyorsCreate,
        });
        return json({
          user: {
            id: u.id,
            username: u.username,
            name: u.display_name || u.username,
            company_name: u.company_name || null,
            role: u.role,
            active: u.active !== false,
            created_at: u.created_at,
            target_quota: u.target_quota ?? target_quota,
            key_id: u.key_id || key_id,
            phone: u.phone || null,
            can_manage_questions: u.can_manage_questions === true,
            can_edit_surveys: u.can_edit_surveys === true,
            can_review_data: u.can_review_data === true,
            can_verify_surveyors: u.can_verify_surveyors === true,
          },
          field_app_access: role === "surveyor",
          field_app_login: role === "surveyor"
            ? { username, note: "Use these credentials on field app (/) " }
            : null,
        }, 201);
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: "Username already exists" }, 409);
        }
        return json({ error: msg || "Could not create user" }, 500);
      }
    }

    // Create a Super Admin (01-PRD.md: max 3 platform-wide). The FIRST Super Admin can be
    // bootstrapped by any portal admin (no super admin password exists yet); afterwards only
    // super_admin accounts can create more.
    if (path === "/api/super-admin" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const name = String(body.name || "Super Admin").trim();
      if (!username || !password) return json({ error: "username and password required" }, 400);
      if (password.length < 8) return json({ error: "Password min 8 characters" }, 400);
      const countRows = await sql`SELECT COUNT(*) AS n FROM app_users WHERE role = 'super_admin'`;
      const count = Number((countRows[0] as { n?: unknown } | undefined)?.n ?? 0);
      if (count === 0) {
        if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      } else {
        if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
        if (count >= 3) return json({ error: "Super Admin cap of 3 reached" }, 403);
      }
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('super_admin','admin','field','user','surveyor'))`.catch(() => null);
      try {
        const password_hash = await hashPasswordAsync(password);
        const key_id = await uniqueUserKeyId();
        const inserted = await sql`
          INSERT INTO app_users (username, password_hash, display_name, role, active, key_id)
          VALUES (${username}, ${password_hash}, ${name}, 'super_admin', TRUE, ${key_id})
          RETURNING id, username, display_name, role, active, created_at, key_id
        `;
        const u = inserted[0] as Record<string, unknown>;
        logAudit(me, "super_admin_create", "user", u.id, { username: u.username });
        return json({
          user: {
            id: u.id,
            username: u.username,
            name: u.display_name || u.username,
            role: u.role,
            active: u.active !== false,
            created_at: u.created_at,
            key_id: u.key_id || key_id,
          },
        }, 201);
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: "Username already exists" }, 409);
        }
        return json({ error: msg || "Could not create super admin" }, 500);
      }
    }

    // Bootstrap escape hatch: a portal admin can reset the password of the ONLY existing
    // Super Admin (e.g. auto-bootstrapped account whose printed password was lost).
    if (path === "/api/super-admin/reset" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const password = String(body.password || "");
      if (password.length < 8) return json({ error: "Password min 8 characters" }, 400);
      const countRows = await sql`SELECT COUNT(*) AS n FROM app_users WHERE role = 'super_admin'`;
      const count = Number((countRows[0] as { n?: unknown } | undefined)?.n ?? 0);
      if (count !== 1) {
        return json({
          error: "Reset allowed only when exactly one Super Admin exists",
        }, 403);
      }
      const saRows = await sql`SELECT id, username FROM app_users WHERE role = 'super_admin' LIMIT 1`;
      const sa = saRows[0] as { id: number; username: string } | undefined;
      if (!sa) return json({ error: "No Super Admin found" }, 404);
      const password_hash = await hashPasswordAsync(password);
      await sql`UPDATE app_users SET password_hash = ${password_hash} WHERE id = ${sa.id}`;
      logAudit(me, "super_admin_reset", "user", sa.id, { username: sa.username });
      return json({ ok: true, username: sa.username });
    }

    // Bulk generate surveyors: { count, prefix, password, target_quota }
    if (path === "/api/users/generate" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      let count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
      const prefix = String(body.prefix || "s").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || "s";
      // Surveyor cap: a Client Admin may only create surveyors up to the Super-Admin-set
      // max_surveyors (0 = unlimited). Clamp the requested batch to the remaining allowance.
      let bulkRemaining = -1; // -1 = no cap
      if (me.role !== "super_admin") {
        const cap = Number((me as Record<string, unknown>).max_surveyors) || 0;
        if (cap > 0) {
          const [sc] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'surveyor' AND created_by = ${me.id}`.catch(() => [{ n: 0 }]);
          const surveyorCount = Number((sc as { n?: unknown }[])[0]?.n ?? 0);
          const remaining = Math.max(0, cap - surveyorCount);
          if (remaining <= 0) {
            return json({
              error: `Surveyor limit reached — max ${cap} surveyors (set by Super Admin). Delete a surveyor or ask Super Admin to raise the limit.`,
            }, 422);
          }
          count = Math.min(count, remaining);
          bulkRemaining = remaining;
        }
      }
      const password = String(body.password || "survey123");
      const target_quota = Math.max(0, Math.min(Number(body.target_quota) || 0, 100000));
      // Explicit usernames (one per line / comma separated) take priority over prefix+count
      const rawUsernames = Array.isArray(body.usernames)
        ? body.usernames
        : String(body.usernames_list || "").split(/[\n,;]+/);
      const usernames = rawUsernames
        .map((u: unknown) => String(u).trim().toLowerCase())
        .filter((u: string) => /^[a-z0-9_]{2,40}$/.test(u))
        .slice(0, 100);
      // Explicit usernames must also respect the cap — clamp the list to the allowance
      const names = usernames.length
        ? bulkRemaining >= 0
          ? usernames.slice(0, bulkRemaining)
          : usernames
        : Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(3, "0")}`);
      const created: {
        username: string;
        password: string;
        name: string;
        target_quota: number;
        key_id: string;
      }[] = [];
      await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`.catch(() => null);
      await sql`
        ALTER TABLE app_users
        ADD CONSTRAINT app_users_role_check
        CHECK (role IN ('super_admin', 'admin', 'field', 'user', 'surveyor'))
      `.catch(() => null);
      await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`
        .catch(() => null);

      const password_hash = await hashPasswordAsync(password);
      const errors: string[] = [];
      for (const username of names) {
        const displayName = `Surveyor ${username}`;
        try {
          const key_id = await uniqueUserKeyId();
          await sql`
            INSERT INTO app_users (username, password_hash, display_name, role, target_quota, active, key_id, created_by)
            VALUES (${username}, ${password_hash}, ${displayName}, ${"surveyor"}, ${target_quota}, TRUE, ${key_id}, ${me.id})
          `;
          created.push({ username, password, name: displayName, target_quota, key_id });
        } catch (e) {
          errors.push(`${username}: ${(e as Error).message || "exists"}`);
        }
      }
      logAudit(me, "users_bulk_create", "user", null, {
        count: created.length,
        prefix: names[0] || "",
        target_quota,
      });
      return json({
        ok: true,
        created: created.length,
        target_quota,
        users: created,
        field_app_access: true,
        field_app_url: "/",
        note: created.length
          ? `Each surveyor can login to field app with password "${password}". Target = ${target_quota}.`
          : "No users created — usernames may already exist. Try prefix t or s2.",
        errors: errors.length ? errors.slice(0, 5) : undefined,
      }, 201);
    }

    // Profile media upload endpoint (photo, aadhaar_front, aadhaar_back)
    if (
      (path === "/api/users/profile-media" ||
        path.match(/^\/api\/users\/\d+\/media$/) ||
        path.match(/^\/api\/users\/\d+\/profile-media$/)) &&
      method === "POST"
    ) {
      if (!me) return json({ error: "Login required" }, 401);
      const urlParts = path.split("/");
      const pathId = urlParts.length >= 4 && /^\d+$/.test(urlParts[3]) ? Number(urlParts[3]) : null;
      const body = await readBody(req);
      const targetId = pathId || Number(body.user_id) || Number(body.id) || me.id;
      if (!targetId) return json({ error: "Invalid user id" }, 400);

      if (me.role !== "admin" && me.id !== targetId) {
        return json({ error: "Forbidden — can only edit own profile media" }, 403);
      }

      const existing = await sql`
        SELECT id, username, display_name, photo, aadhaar_front, aadhaar_back, verified
        FROM app_users WHERE id = ${targetId}
      `;
      if (!existing.length) return json({ error: "User not found" }, 404);

      // Lock uploads for verified surveyors — only admin can change
      const exUser = existing[0] as Record<string, unknown>;
      if (exUser.verified === true && me.role !== "admin") {
        return json({
          error: "Profile media is locked after Admin Verification. Only Admin can update photo or Aadhaar documents.",
        }, 403);
      }

      let photoVal = body.photo !== undefined ? (body.photo ? String(body.photo) : null) : null;
      let aadhaarFrontVal = body.aadhaar_front !== undefined ? (body.aadhaar_front ? String(body.aadhaar_front) : null) : null;
      let aadhaarBackVal = body.aadhaar_back !== undefined ? (body.aadhaar_back ? String(body.aadhaar_back) : null) : null;

      const field = String(body.field || body.kind || "").toLowerCase();
      const singleData = body.data !== undefined ? String(body.data) : body.url !== undefined ? String(body.url) : body.value !== undefined ? String(body.value) : null;

      if (singleData !== null) {
        if (field === "photo") photoVal = singleData || null;
        else if (field === "aadhaar_front" || field === "aadhaar-front" || field === "aadhaarfront") aadhaarFrontVal = singleData || null;
        else if (field === "aadhaar_back" || field === "aadhaar-back" || field === "aadhaarback") aadhaarBackVal = singleData || null;
      }

      const ex = existing[0] as Record<string, unknown>;
      let nextPhoto = photoVal !== null ? photoVal : ((ex.photo as string | null) || null);
      let nextAadhaarFront = aadhaarFrontVal !== null ? aadhaarFrontVal : ((ex.aadhaar_front as string | null) || null);
      let nextAadhaarBack = aadhaarBackVal !== null ? aadhaarBackVal : ((ex.aadhaar_back as string | null) || null);

      for (const [k, v] of [["photo", nextPhoto], ["aadhaar_front", nextAadhaarFront], ["aadhaar_back", nextAadhaarBack]] as const) {
        if (v && typeof v === "string" && v.length > 4_500_000) {
          return json({ error: `${k} image too large. Max 3MB base64 per image.` }, 413);
        }
      }

      // Store in Cloudflare R2 if configured
      const processR2 = async (field: "photo" | "aadhaar_front" | "aadhaar_back", val: string | null) => {
        if (!val || !val.startsWith("data:image/")) return val;
        const mimeMatch = val.match(/^data:([^;]+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
        const b64Data = mimeMatch ? val.slice(mimeMatch[0].length) : val;
        try {
          const bytes = b64ToBytes(b64Data);
          const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
          const objectKey = `profiles/${targetId}/${field}_${Date.now()}.${ext}`;
          const r2 = await tryOptionalExternalUpload(bytes, mime, field, objectKey, `${field}.${ext}`);
          if (r2?.url) return r2.url;
        } catch {
          /* fallback to dataUrl */
        }
        return val;
      };

      if (photoVal !== null && photoVal) nextPhoto = await processR2("photo", photoVal);
      if (aadhaarFrontVal !== null && aadhaarFrontVal) nextAadhaarFront = await processR2("aadhaar_front", aadhaarFrontVal);
      if (aadhaarBackVal !== null && aadhaarBackVal) nextAadhaarBack = await processR2("aadhaar_back", aadhaarBackVal);

      const updated = await sql`
        UPDATE app_users
        SET photo = ${nextPhoto},
            aadhaar_front = ${nextAadhaarFront},
            aadhaar_back = ${nextAadhaarBack}
        WHERE id = ${targetId}
        RETURNING id, username, display_name, key_id, phone, photo, aadhaar_front, aadhaar_back
      `;

      const u = updated[0] as Record<string, unknown>;
      return json({
        ok: true,
        user_id: u.id,
        username: u.username,
        photo: u.photo || null,
        aadhaar_front: u.aadhaar_front || null,
        aadhaar_back: u.aadhaar_back || null,
      });
    }

    // Edit user profile (Admin: all fields / Surveyor: own phone before verification)
    if (path.startsWith("/api/users/") && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      const id = Number(path.split("/").pop());
      if (!id) return json({ error: "Invalid id" }, 400);
      const body = await readBody(req);

      const existing = await sql`SELECT * FROM app_users WHERE id = ${id}`;
      if (!existing.length) return json({ error: "Not found" }, 404);
      const ex = existing[0] as Record<string, unknown>;

      const isSelf = me.id === id;
      const isAdmin = isPortalAdmin(me.role);

      if (!isAdmin && !isSelf) {
        return json({ error: "Forbidden — can only update own profile" }, 403);
      }

      // BR-004 tenant scoping: a Client Admin may only manage surveyors they
      // created (created_by = me.id). Super Admin manages every account.
      if (isAdmin && me.role !== "super_admin" && !isSelf &&
          Number(ex.created_by) !== me.id) {
        return json({ error: "Forbidden — that account belongs to another Client Admin" }, 403);
      }

      // Freeze phone, photo and Aadhaar edits for surveyors once verified by Admin
      if (ex.verified === true && !isAdmin) {
        const lockedFields = ['phone', 'photo', 'aadhaar_front', 'aadhaar_back'].filter(f => body[f] !== undefined)
        if (lockedFields.length > 0) {
          return json({
            error: `${lockedFields.join(', ')} ${lockedFields.length > 1 ? 'are' : 'is'} locked after Admin Verification. Only Admin can change them.`,
          }, 403);
        }
      }

      // Non-admins can ONLY update their own phone or photo
      if (!isAdmin) {
        if (body.username !== undefined || body.password !== undefined || body.active !== undefined || body.role !== undefined || body.verified !== undefined || body.target_quota !== undefined) {
          return json({ error: "Surveyors can only update their phone number or profile photo." }, 403);
        }
      }

      // revoke_sessions only — kick user offline without other changes
      if (body.revoke_sessions === true && body.password == null && body.username == null &&
          body.active == null && body.name == null && body.target_quota == null && body.role == null) {
        const del = await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
        return json({
          ok: true,
          revoked: true,
          sessions_cleared: Array.isArray(del) ? del.length : true,
          user_id: id,
          username: ex.username,
        });
      }

      let password_hash = ex.password_hash;
      let passwordChanged = false;
      if (body.password != null && String(body.password).length > 0) {
        if (String(body.password).length < 4) {
          return json({ error: "Password min 4 characters" }, 400);
        }
        password_hash = await hashPasswordAsync(String(body.password));
        passwordChanged = true;
      }

      let nextUsername = ex.username;
      if (body.username != null && String(body.username).trim()) {
        nextUsername = String(body.username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
        if (!nextUsername || nextUsername.length < 2) {
          return json({ error: "Username min 2 characters (letters/numbers)" }, 400);
        }
        if (nextUsername !== ex.username) {
          const clash = await sql`
            SELECT id FROM app_users WHERE LOWER(username) = ${nextUsername} AND id <> ${id} LIMIT 1
          `;
          if (clash.length) return json({ error: "Username already taken" }, 409);
        }
      }

      const nextActive = typeof body.active === "boolean" ? body.active : ex.active;
      if (id === me.id && nextActive === false) {
        return json({ error: "Cannot disable your own admin account" }, 400);
      }
      if (id === me.id && nextUsername !== ex.username) {
        // allow rename self carefully
      }

      const nextName = body.name != null ? String(body.name).trim() : ex.display_name;
      let nextCompanyName =
        body.company_name !== undefined && me.role === "super_admin" && ex.role === "admin"
          ? String(body.company_name || "").trim().slice(0, 160) || null
          : (ex as Record<string, unknown>).company_name || null;
      // Company registry link: when Super Admin explicitly changes a Client Admin's
      // company_name, relink to a registered company with that name (or unlink).
      const companyNameChanged =
        body.company_name !== undefined && me.role === "super_admin" && ex.role === "admin";
      let nextCompanyId: number | null =
        (ex as Record<string, unknown>).company_id != null
          ? Number((ex as Record<string, unknown>).company_id)
          : null;
      if (companyNameChanged) {
        nextCompanyId = null;
        if (nextCompanyName && sql) {
          const comp = await ensureCompanyExists(sql, nextCompanyName, me.id);
          if (comp) {
            nextCompanyId = comp.id;
            nextCompanyName = comp.name;
          }
        }
      }
      const nextPhone =
        body.phone != null ? String(body.phone).trim() : (ex as Record<string, unknown>).phone || null;
      const nextPhoto =
        body.photo != null ? String(body.photo).trim() : (ex as Record<string, unknown>).photo || null;
      const nextAadhaarFront =
        body.aadhaar_front != null ? String(body.aadhaar_front).trim() : (ex as Record<string, unknown>).aadhaar_front || null;
      const nextAadhaarBack =
        body.aadhaar_back != null ? String(body.aadhaar_back).trim() : (ex as Record<string, unknown>).aadhaar_back || null;
      const nextVerified =
        typeof body.verified === "boolean" ? body.verified : (ex as Record<string, unknown>).verified === true;
      const nextRole =
        body.role === "admin" || body.role === "surveyor" ? body.role : ex.role;
      const nextQuota =
        body.target_quota != null
          ? Math.max(0, Math.min(Number(body.target_quota) || 0, 100000))
          : Number(ex.target_quota) || 0;
      const nextMaxQuestionsPerSurvey =
        body.max_questions_per_survey !== undefined && me.role === "super_admin"
          ? Math.max(0, Math.min(Number(body.max_questions_per_survey) || 0, 100000))
          : Number((ex as Record<string, unknown>).max_questions_per_survey) || 0;
      const nextMaxSurveys =
        body.max_surveys !== undefined && me.role === "super_admin"
          ? Math.max(0, Math.min(Number(body.max_surveys) || 0, 100000))
          : Number((ex as Record<string, unknown>).max_surveys) || 0;
      const nextMaxSurveyors =
        body.max_surveyors !== undefined && me.role === "super_admin"
          ? Math.max(0, Math.min(Number(body.max_surveyors) || 0, 100000))
          : Number((ex as Record<string, unknown>).max_surveyors) || 0;
      // Grant-based powers — only Super Admin grants/revokes them (least privilege)
      const POWER_KEYS = [
        "can_manage_questions",
        "can_edit_surveys",
        "can_review_data",
        "can_verify_surveyors",
        "can_crud_questionnaire",
        "can_validate_proof",
      ] as const;
      const nextPowers: Record<string, boolean> = {};
      for (const k of POWER_KEYS) {
        const cur = (ex as Record<string, unknown>)[k] === true;
        nextPowers[k] =
          body[k] === undefined
            ? cur
            : me.role === "super_admin"
              ? body[k] === true
              : cur;
      }
      // Verification gate: surveyors need the granted verify power; client admin accounts
      // can only be verified by the Super Admin (client admins never verify each other)
      if (body.verified !== undefined) {
        const targetRole = String((ex as Record<string, unknown>).role || "");
        const isAdminTarget = targetRole === "admin" || targetRole === "super_admin";
        if (isAdminTarget ? me.role !== "super_admin" : !hasPower(me, "can_verify_surveyors")) {
          return json({
            error: isAdminTarget
              ? "Only Super Admin can verify client admin accounts"
              : "Super Admin has not granted your account surveyor-verification rights",
          }, 403);
        }
      }

      let rows;
      try {
        rows = await sql`
          UPDATE app_users
          SET username = ${nextUsername},
              password_hash = ${password_hash},
              display_name = ${nextName},
              company_name = ${nextCompanyName},
              company_id = ${nextCompanyId},
              role = ${nextRole},
              active = ${nextActive},
              target_quota = ${nextQuota},
              phone = ${nextPhone},
              photo = ${nextPhoto},
              aadhaar_front = ${nextAadhaarFront},
              aadhaar_back = ${nextAadhaarBack},
              verified = ${nextVerified},
              can_manage_questions = ${nextPowers.can_manage_questions},
              can_edit_surveys = ${nextPowers.can_edit_surveys},
              can_review_data = ${nextPowers.can_review_data},
              can_verify_surveyors = ${nextPowers.can_verify_surveyors},
              can_crud_questionnaire = ${nextPowers.can_crud_questionnaire},
              can_validate_proof = ${nextPowers.can_validate_proof},
              max_questions_per_survey = ${nextMaxQuestionsPerSurvey},
              max_surveys = ${nextMaxSurveys},
              max_surveyors = ${nextMaxSurveyors}
          WHERE id = ${id}
          RETURNING id, username, display_name, company_name, role, active, created_at, target_quota, key_id, phone, photo, aadhaar_front, aadhaar_back, verified, can_manage_questions, can_edit_surveys, can_review_data, can_verify_surveyors, can_crud_questionnaire, can_validate_proof, max_questions_per_survey, max_surveys, max_surveyors
        `;
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: "Username already taken" }, 409);
        }
        return json({ error: msg || "Update failed" }, 500);
      }

      // Disable or password/username change → revoke all sessions (force re-login)
      const shouldRevoke =
        body.revoke_sessions === true ||
        nextActive === false ||
        passwordChanged ||
        nextUsername !== ex.username;
      let sessionsCleared = 0;
      if (shouldRevoke) {
        const del = await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
        sessionsCleared = Array.isArray(del) ? del.length : 0;
      }

      // FR-AUD-01: log admin-driven account changes (not self phone/photo-only edits)
      const adminChanged =
        nextActive !== ex.active ||
        passwordChanged ||
        nextUsername !== ex.username ||
        body.role !== undefined ||
        body.target_quota !== undefined ||
        body.verified !== undefined ||
        body.max_questions_per_survey !== undefined ||
        body.max_surveys !== undefined ||
        body.max_surveyors !== undefined ||
        POWER_KEYS.some((k) => body[k] !== undefined);
      if (adminChanged && isAdmin) {
        logAudit(me, "user_update", "user", id, {
          username: ex.username,
          active: nextActive,
          password_changed: passwordChanged,
          role_changed: body.role !== undefined,
          quota_changed: body.target_quota !== undefined,
          verified_changed: body.verified !== undefined,
          powers_changed: POWER_KEYS.filter((k) => body[k] !== undefined),
        });
      }

      const u = rows[0] as Record<string, unknown>;
      return json({
        ok: true,
        user: {
          id: u.id,
          username: u.username,
          name: u.display_name || u.username,
          company_name: u.company_name || null,
          role: u.role,
          active: u.active,
          created_at: u.created_at,
          target_quota: u.target_quota ?? nextQuota,
          key_id: u.key_id || null,
          phone: u.phone || nextPhone || null,
          photo: u.photo || nextPhoto || null,
          aadhaar_front: u.aadhaar_front || nextAadhaarFront || null,
          aadhaar_back: u.aadhaar_back || nextAadhaarBack || null,
          verified: u.verified === true,
          can_manage_questions: u.can_manage_questions === true,
          can_edit_surveys: u.can_edit_surveys === true,
          can_review_data: u.can_review_data === true,
          can_verify_surveyors: u.can_verify_surveyors === true,
          max_questions_per_survey: Number(u.max_questions_per_survey) || 0,
          max_surveys: Number(u.max_surveys) || 0,
          max_surveyors: Number(u.max_surveyors) || 0,
        },
        password_changed: passwordChanged,
        username_changed: nextUsername !== ex.username,
        disabled: nextActive === false,
        sessions_revoked: shouldRevoke,
        sessions_cleared: sessionsCleared,
        plain_password: passwordChanged ? String(body.password) : undefined,
      });
    }

    // DELETE user (optional hard remove) — prefer disable
    if (path.startsWith("/api/users/") && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/").pop());
      if (!id) return json({ error: "Invalid id" }, 400);
      if (id === me.id) return json({ error: "Cannot delete your own account" }, 400);
      const existing = await sql`SELECT id, username, role, created_by FROM app_users WHERE id = ${id}`;
      if (!existing.length) return json({ error: "Not found" }, 404);
      // BR-004 tenant scoping: a Client Admin may only delete surveyors they created.
      if (me.role !== "super_admin" && Number((existing[0] as { created_by?: unknown }).created_by) !== me.id) {
        return json({ error: "Forbidden — that account belongs to another Client Admin" }, 403);
      }
      await sql`DELETE FROM app_sessions WHERE user_id = ${id}`;
      await sql`DELETE FROM app_users WHERE id = ${id}`;
      logAudit(me, "user_delete", "user", id, {
        username: (existing[0] as { username: string }).username,
        role: (existing[0] as { role: string }).role,
      });
      return json({
        ok: true,
        deleted: true,
        id,
        username: (existing[0] as { username: string }).username,
      });
    }

    // ── Super Admin platform governance (01-PRD.md §Super Admin) ──
    // FR-AUD-02: platform-wide audit log, per actor account, Super Admin only.
    if (path === "/api/audit-log" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const action = String(url.searchParams.get("action") || "").trim();
      const actor = String(url.searchParams.get("actor") || "").trim();
      const entity = String(url.searchParams.get("entity") || "").trim();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 150, 1), 500);
      const rows = await sql`
        SELECT id, actor_id, actor_name, actor_role, action, entity_type, entity_id, meta, created_at
        FROM audit_log
        WHERE (${action} = '' OR action = ${action})
          AND (${actor} = '' OR actor_name ILIKE ${`%${actor}%`})
          AND (${entity} = '' OR entity_type = ${entity})
        ORDER BY id DESC LIMIT ${limit}
      `.catch(() => []);
      return json({ entries: rows, count: (rows as unknown[]).length });
    }

    // FR-QB-02: Global Question Bank — Super Admin authors is_global templates;
    // Client Admins see global + their own, and can copy any into a survey.
    if (path === "/api/question-bank" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const rows = await sql`
        SELECT id, name, questions, is_global, created_by, created_at, updated_at
        FROM question_bank
        WHERE is_global = TRUE OR created_by = ${me.id}
        ORDER BY is_global DESC, id DESC
      `.catch(() => []);
      return json({ templates: rows });
    }

    if (path === "/api/question-bank" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
      if (me.role !== "super_admin" && me.can_manage_questions !== true) {
        return json({
          error: "Super Admin has not granted your account Question Bank edit rights",
        }, 403);
      }
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const questions = Array.isArray(body.questions) ? body.questions : [];
      if (!name) return json({ error: "Template name required" }, 400);
      // is_global forced true only for super_admin (FR-QB-02)
      const isGlobal = me.role === "super_admin" && body.is_global === true;
      const rows = await sql`
        INSERT INTO question_bank (name, questions, is_global, created_by)
        VALUES (${name}, ${JSON.stringify(questions)}::jsonb, ${isGlobal}, ${me.id})
        RETURNING id, name, questions, is_global, created_by, created_at, updated_at
      `.catch(() => []);
      const t = (rows as Record<string, unknown>[])[0];
      if (!t) return json({ error: "Could not create template" }, 500);
      logAudit(me, "question_bank_create", "question_bank", t.id, {
        name,
        is_global: isGlobal,
        questions: questions.length,
      });
      return json({ template: t }, 201);
    }

    if (path.startsWith("/api/question-bank/") && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
      if (me.role !== "super_admin" && me.can_manage_questions !== true) {
        return json({
          error: "Super Admin has not granted your account Question Bank edit rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const rows = await sql`SELECT * FROM question_bank WHERE id = ${id}`.catch(() => []);
      const t = rows[0] as Record<string, unknown> | undefined;
      if (!t) return json({ error: "Not found" }, 404);
      // FR-QB-02 / BR-003: global templates are Super Admin authored — no tenant can alter them
      if (t.is_global === true && me.role !== "super_admin") {
        return json({ error: "Global templates are Super Admin only" }, 403);
      }
      const isOwner = Number(t.created_by) === Number(me.id);
      if (!isOwner && me.role !== "super_admin") {
        return json({ error: "Only the author or Super Admin can edit this template" }, 403);
      }
      const name = String(body.name != null ? body.name : t.name || "Template").trim() || "Template";
      const questions = Array.isArray(body.questions)
        ? body.questions
        : (Array.isArray(t.questions) ? t.questions : []);
      const isGlobal = t.is_global === true || (me.role === "super_admin" && body.is_global === true);
      await sql`
        UPDATE question_bank
        SET name = ${name}, questions = ${JSON.stringify(questions)}::jsonb,
            is_global = ${isGlobal}, updated_at = NOW()
        WHERE id = ${id}
      `.catch(() => null);
      logAudit(me, "question_bank_update", "question_bank", id, { name, is_global: isGlobal });
      return json({ ok: true });
    }

    if (path.startsWith("/api/question-bank/") && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // FR-QB-02: bank CRUD needs the Super-Admin-granted power (least privilege)
      if (me.role !== "super_admin" && me.can_manage_questions !== true) {
        return json({
          error: "Super Admin has not granted your account Question Bank edit rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const rows = await sql`SELECT id, name, created_by, is_global FROM question_bank WHERE id = ${id}`.catch(() => []);
      const t = rows[0] as Record<string, unknown> | undefined;
      if (!t) return json({ error: "Not found" }, 404);
      // FR-QB-02 / BR-003: global templates are Super Admin authored — no tenant can alter them
      if (t.is_global === true && me.role !== "super_admin") {
        return json({ error: "Global templates are Super Admin only" }, 403);
      }
      const isOwner = Number(t.created_by) === Number(me.id);
      if (!isOwner && me.role !== "super_admin") {
        return json({ error: "Only the author or Super Admin can delete this template" }, 403);
      }
      await sql`DELETE FROM question_bank WHERE id = ${id}`.catch(() => null);
      logAudit(me, "question_bank_delete", "question_bank", id, { name: t.name });
      return json({ ok: true, deleted: true });
    }

    // Copy a bank template into a real survey (survey_form) so surveyors can use it.
    if (path.match(/^\/api\/question-bank\/\d+\/copy$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      // Copying a template creates a survey — needs questionnaire CRUD or survey-editing power
      if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account questionnaire-editing rights",
        }, 403);
      }
      const body = await readBody(req);
      const id = Number(path.split("/")[3]);
      // Enforce client-scoped visibility: only global templates or the client's own
      const rows = await sql`SELECT id, name, questions FROM question_bank WHERE id = ${id} AND (is_global = TRUE OR created_by = ${me.id} OR ${me.role} = 'super_admin')`.catch(() => []);
      const t = rows[0] as Record<string, unknown> | undefined;
      if (!t) return json({ error: "Not found" }, 404);
      let questions = Array.isArray(t.questions) ? t.questions : [];
      // Select number of questions — subset by question_count (default all), capped by the
      // Super-Admin-set per-survey question cap for this Client Admin (0 = unlimited)
      const maxQs = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
      const cap = maxQs > 0 ? Math.min(maxQs, questions.length) : questions.length;
      if (body.question_count) {
        const limit = Math.max(1, Math.min(Number(body.question_count), cap));
        questions = questions.slice(0, limit);
      } else if (maxQs > 0 && questions.length > maxQs) {
        questions = questions.slice(0, maxQs);
      }
      // Super-Admin-set cap on how many surveys this Client Admin may create (0 = unlimited)
      const maxSvCopy = Number((me as Record<string, unknown>).max_surveys) || 0;
      if (maxSvCopy > 0) {
        const mine = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        const createdCount = Number((mine[0] as { n?: number })?.n || 0);
        if (createdCount >= maxSvCopy) {
          return json({
            error: `Survey limit reached — maximum ${maxSvCopy} surveys (set by Super Admin). Delete or edit an existing survey first.`,
          }, 422);
        }
      }
      const title = `${String(t.name || "Template").trim()} Survey`;
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "survey";
      let formKey = base;
      let n = 1;
      for (;;) {
        const clash = await sql`SELECT id FROM survey_form WHERE form_key = ${formKey} LIMIT 1`;
        if (!(clash as unknown[]).length) break;
        n += 1;
        formKey = `${base}-${n}`;
      }
      const ins = await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at, created_by)
        VALUES (${formKey}, ${title}, ${JSON.stringify(questions)}::jsonb, NOW(), ${me.id})
        RETURNING id, form_key, title
      `.catch(() => []);
      const created = (ins as Record<string, unknown>[])[0];
      if (!created) return json({ error: "Could not create survey from template" }, 500);
      logAudit(me, "question_bank_copy", "survey", created.id, { template: id, title });
      return json({ ok: true, survey: created }, 201);
    }

    // BR-006 / FR-USR-10: seat-limit upgrade requests.
    if (path === "/api/seat-limit-requests" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const [limits] = await sql`SELECT seat_role, approved_limit, updated_at, updated_by FROM seat_limits`.catch(() => []);
      const [cnt] = await sql`SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin' AND active = TRUE`.catch(() => [{ n: 0 }]);
      const reqs = me.role === "super_admin"
        ? await sql`
            SELECT id, requested_by, requested_by_name, seat_role, requested_limit, reason,
                   status, decided_by, decided_by_name, decided_at, created_at
            FROM seat_limit_requests ORDER BY id DESC LIMIT 200
          `.catch(() => [])
        : await sql`
            SELECT id, requested_by, requested_by_name, seat_role, requested_limit, reason,
                   status, decided_by, decided_by_name, decided_at, created_at
            FROM seat_limit_requests WHERE requested_by = ${me.id} ORDER BY id DESC LIMIT 200
          `.catch(() => []);
      return json({
        requests: reqs,
        limits: (limits as Record<string, unknown>) || null,
        current_admins: Number((cnt as { n?: unknown }[])[0]?.n ?? 0),
        can_submit: me.role === "admin",
      });
    }

    if (path === "/api/seat-limit-requests" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin") {
        return json({ error: "Only Client Admins submit seat upgrade requests" }, 403);
      }
      const body = await readBody(req);
      const requestedLimit = Math.max(1, Math.min(Number(body.requested_limit) || 0, 10000));
      const reason = String(body.reason || "").trim();
      if (!requestedLimit) return json({ error: "requested_limit required" }, 400);
      const open = await sql`
        SELECT id FROM seat_limit_requests WHERE requested_by = ${me.id} AND status = 'pending' LIMIT 1
      `.catch(() => []);
      if ((open as unknown[]).length) {
        return json({ error: "You already have a pending seat upgrade request" }, 409);
      }
      const rows = await sql`
        INSERT INTO seat_limit_requests (requested_by, requested_by_name, seat_role, requested_limit, reason)
        VALUES (${me.id}, ${me.name || me.username}, 'admin', ${requestedLimit}, ${reason || null})
        RETURNING id, seat_role, requested_limit, reason, status, created_at
      `.catch(() => []);
      const r = (rows as Record<string, unknown>[])[0];
      if (!r) return json({ error: "Could not create request" }, 500);
      logAudit(me, "seat_request_submit", "seat_limit_requests", r.id, {
        seat_role: "admin",
        requested_limit: requestedLimit,
      });
      return json({ request: r }, 201);
    }

    if (path.match(/^\/api\/seat-limit-requests\/\d+\/(approve|deny)$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const approve = path.endsWith("/approve");
      const rows = await sql`SELECT * FROM seat_limit_requests WHERE id = ${id}`.catch(() => []);
      const r = rows[0] as Record<string, unknown> | undefined;
      if (!r) return json({ error: "Not found" }, 404);
      if (r.status !== "pending") return json({ error: "Request already decided" }, 409);
      if (approve) {
        await sql`
          INSERT INTO seat_limits (seat_role, approved_limit, updated_at, updated_by)
          VALUES (${String(r.seat_role || "admin")}, ${Number(r.requested_limit)}, NOW(), ${me.name || me.username})
          ON CONFLICT (seat_role)
          DO UPDATE SET approved_limit = ${Number(r.requested_limit)}, updated_at = NOW(), updated_by = ${me.name || me.username}
        `.catch(() => null);
      }
      await sql`
        UPDATE seat_limit_requests
        SET status = ${approve ? "approved" : "denied"}, decided_by = ${me.id},
            decided_by_name = ${me.name || me.username}, decided_at = NOW()
        WHERE id = ${id}
      `.catch(() => null);
      logAudit(me, approve ? "seat_request_approve" : "seat_request_deny", "seat_limit_requests", id, {
        seat_role: r.seat_role,
        requested_limit: r.requested_limit,
        requested_by: r.requested_by_name,
      });
      return json({ ok: true, status: approve ? "approved" : "denied" });
    }

    if (path === "/api/submissions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
      const statusQ = (url.searchParams.get("status") || "").trim().toLowerCase();
      let dateFrom = (url.searchParams.get("date_from") || "").trim();
      let dateTo = (url.searchParams.get("date_to") || "").trim();
      const periodQ = (url.searchParams.get("period") || "total").trim().toLowerCase();
      const dayParam = (url.searchParams.get("day") || "").trim();
      const monthParam = (url.searchParams.get("month") || "").trim();
      if (periodQ === "today") {
        const t = new Date().toISOString().slice(0, 10);
        dateFrom = t;
        dateTo = t;
      } else if (periodQ === "day" && dayParam) {
        dateFrom = dayParam;
        dateTo = dayParam;
      } else if (periodQ === "month" && monthParam) {
        const [y, m] = monthParam.split("-").map(Number);
        if (y && m) {
          const last = new Date(y, m, 0).getDate();
          dateFrom = `${monthParam}-01`;
          dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
        }
      }
      const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
      const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
      const completenessQ = (url.searchParams.get("completeness") || "").trim().toLowerCase();
      // Dynamic question filters (q_<questionId> → value) — from Client Admin question naming
      const qFilters: [string, string][] = [];
      for (const [k, v] of url.searchParams) {
        if (k.startsWith("q_") && v.trim()) qFilters.push([k.slice(2), v.trim()]);
      }
      // Filters apply AFTER the LIMIT in JS below — so when any filter is set, fetch
      // a wide slice (oldest rows like legacy data would otherwise be unreachable).
      const hasSliceFilter =
        (statusQ && statusQ !== "all") ||
        Boolean(dateFrom) ||
        Boolean(dateTo) ||
        Boolean(userQ) ||
        Boolean(districtQ) ||
        Boolean(completenessQ && completenessQ !== "all") ||
        qFilters.length > 0 ||
        Boolean((url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim());
      const fetchRows = hasSliceFilter ? 5000 : limit;
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload, fact_status, fact_error, created_at FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT ${fetchRows}
          `
        : await sql`
            SELECT id, payload, fact_status, fact_error, created_at FROM submissions
            ORDER BY created_at DESC LIMIT ${fetchRows}
          `;
      // media kinds for strict voice/photo checks
      const mediaMap = await loadMediaKindsMap(sql);

      let items = (rows as Record<string, unknown>[]).map((r) => {
        const payload = parsePayload(r.payload);
        const answers = (payload?.answers || payload) as Record<string, unknown>;
        const status = payloadStatus(payload);
        const verify = verifyWithMedia(payload, mediaMap, Number(r.id));
        const submittedBy = surveyorNameOf(payload);
        const draft = isDraftSubmission(payload);
        const work = workStatusOf(payload);
        return {
          id: r.id,
          source: (payload?.source as string) || "app",
          form_id: (payload?.form_id as string) || "",
          form_key: String(payload?.form_key || "default"),
          created_at: r.created_at,
          date: dayKey(isoStamp(r.created_at)),
          status,
          fact_status: r.fact_status ?? null,
          fact_error: r.fact_error ?? null,
          work,
          draft,
          completeness: verify.completeness,
          verification: verify,
          legacy: !!verify.legacy,
          submitted_by: submittedBy === "unknown" ? "" : submittedBy,
          user_id: payload?.user_id ?? null,
          confirmed_at: payload?.confirmed_at || null,
          confirmed_by: payload?.confirmed_by || null,
          answers,
          qa: qaFromAnswers(answers || {}),
          has_geo: verify.geo_ok,
          has_voice: verify.voice_ok,
          has_photo: verify.photo_ok,
          // Free storage links (not Neon blobs)
          photo_url: payload?.photo_url || null,
          audio_url: payload?.audio_url || null,
          media_storage: payload?.media_storage || null,
          proof_validated: payload?.proof_validated || null,
        };
      });

      if (statusQ && statusQ !== "all") {
        items = items.filter((x) => x.status === statusQ);
      }
      if (qFilters.length) {
        // question id → type, so age-type filters bucket-match ranges
        const qTypeMap = new Map<string, string>();
        {
          const frows = await sql`SELECT questions FROM survey_form`.catch(() => []);
          for (const f of frows as { questions?: unknown }[]) {
            let qs = f.questions;
            if (typeof qs === "string") { try { qs = JSON.parse(qs); } catch { qs = []; } }
            if (!Array.isArray(qs)) continue;
            for (const q of qs as Record<string, unknown>[]) {
              const id = String(q.id || q.label || "");
              if (id) qTypeMap.set(id, String(q.type || "text"));
            }
          }
        }
        items = items.filter((x) => {
          for (const [qid, want] of qFilters) {
            const av = (x as { answers?: Record<string, unknown> }).answers;
            const val = answerOf(av, qid);
            const hit = qTypeMap.get(qid) === "age"
              ? ageBucket(val) === want
              : Array.isArray(val)
                ? val.map(String).includes(want)
                : String(val ?? "") === want;
            if (!hit) return false;
          }
          return true;
        });
      }
      if (dateFrom) items = items.filter((x) => x.date >= dateFrom);
      if (dateTo) items = items.filter((x) => x.date <= dateTo);
      if (userQ) {
        items = items.filter((x) =>
          String(x.submitted_by || "").toLowerCase().includes(userQ)
        );
      }
      const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
      if (surveyQ) {
        items = items.filter((x) => String(x.form_key || "") === surveyQ);
      }
      if (districtQ) {
        items = items.filter((x) => {
          const a = (x as { answers?: Record<string, unknown> }).answers || {};
          return String(a.district || "").toLowerCase().includes(districtQ);
        });
      }
      if (completenessQ === "complete" || completenessQ === "incomplete") {
        items = items.filter((x) => x.completeness === completenessQ);
      }

      const summary = {
        total: items.length,
        complete: items.filter((x) => x.completeness === "complete").length,
        incomplete: items.filter((x) => x.completeness === "incomplete").length,
        // Work: drafts count as pending, not completed
        completed: items.filter((x) => x.work === "completed").length,
        pending: items.filter((x) => x.work === "pending").length,
        confirmed: items.filter((x) => x.work === "completed").length,
        rejected: items.filter((x) => x.work === "rejected").length,
        draft: items.filter((x) => x.draft).length,
        status_confirmed: items.filter((x) => x.status === "confirmed").length,
        status_pending: items.filter((x) => x.status === "pending").length,
        geo_fail: items.filter((x) => !x.has_geo).length,
        voice_fail: items.filter((x) => !x.has_voice).length,
        by_user: {} as Record<
          string,
          {
            total: number;
            complete: number;
            incomplete: number;
            completed: number;
            confirmed: number;
            pending: number;
            draft: number;
          }
        >,
        by_date: {} as Record<
          string,
          {
            total: number;
            complete: number;
            incomplete: number;
            completed: number;
            confirmed: number;
            pending: number;
            draft: number;
          }
        >,
      };
      for (const it of items) {
        const u = it.submitted_by || "unknown";
        if (!summary.by_user[u]) {
          summary.by_user[u] = {
            total: 0,
            complete: 0,
            incomplete: 0,
            completed: 0,
            confirmed: 0,
            pending: 0,
            draft: 0,
          };
        }
        summary.by_user[u].total += 1;
        if (it.completeness === "complete") summary.by_user[u].complete += 1;
        else summary.by_user[u].incomplete += 1;
        if (it.work === "completed") {
          summary.by_user[u].completed += 1;
          summary.by_user[u].confirmed += 1;
        } else if (it.work === "pending") {
          summary.by_user[u].pending += 1;
        }
        if (it.draft) summary.by_user[u].draft += 1;
        const d = it.date || "unknown";
        if (!summary.by_date[d]) {
          summary.by_date[d] = {
            total: 0,
            complete: 0,
            incomplete: 0,
            completed: 0,
            confirmed: 0,
            pending: 0,
            draft: 0,
          };
        }
        summary.by_date[d].total += 1;
        if (it.completeness === "complete") summary.by_date[d].complete += 1;
        else summary.by_date[d].incomplete += 1;
        if (it.work === "completed") {
          summary.by_date[d].completed += 1;
          summary.by_date[d].confirmed += 1;
        } else if (it.work === "pending") {
          summary.by_date[d].pending += 1;
        }
        if (it.draft) summary.by_date[d].draft += 1;
      }

      return json({
        items,
        total: items.length,
        summary,
        filters: {
          status: statusQ || "all",
          date_from: dateFrom || null,
          date_to: dateTo || null,
          user: userQ || null,
          completeness: completenessQ || "all",
        },
        strict: {
          geo_tagging: "required",
          voice_detection: "required",
          photo: "required",
          rule: "complete = geo_ok AND voice_ok AND photo_ok AND qa_ok",
          legacy: "Legacy rows (no GPS/camera) are exempt from geo/voice/photo checks",
        },
      });
    }

    // Client Admin analyze board: by date + user
    if (path === "/api/admin/analyze" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      let dateFrom = (url.searchParams.get("date_from") || "").trim();
      let dateTo = (url.searchParams.get("date_to") || "").trim();
      const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
      const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
      const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
      const constituencyQ = (url.searchParams.get("constituency") || url.searchParams.get("ac") || "").trim().toLowerCase();
      const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
      const dayParam = (url.searchParams.get("day") || "").trim();
      const monthParam = (url.searchParams.get("month") || "").trim();
      const completenessQ = (url.searchParams.get("completeness") || "").trim().toLowerCase();
      // Dynamic question filters (q_<questionId> → value) — from Client Admin question naming
      const qFilters: [string, string][] = [];
      for (const [k, v] of url.searchParams) {
        if (k.startsWith("q_") && v.trim()) qFilters.push([k.slice(2), v.trim()]);
      }
      if (period === "today") {
        const t = new Date().toISOString().slice(0, 10);
        dateFrom = t;
        dateTo = t;
      } else if (period === "day" && dayParam) {
        dateFrom = dayParam;
        dateTo = dayParam;
      } else if (period === "month" && monthParam) {
        const [y, m] = monthParam.split("-").map(Number);
        if (y && m) {
          const last = new Date(y, m, 0).getDate();
          dateFrom = `${monthParam}-01`;
          dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
        }
      }
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT 5000
          `
        : await sql`
            SELECT id, payload, created_at FROM submissions
            ORDER BY created_at DESC LIMIT 5000
          `;
      // question id → type, so age-type q_ filters bucket-match ranges
      const qTypeMap = new Map<string, string>();
      {
        const frows = await sql`SELECT questions FROM survey_form`.catch(() => []);
        for (const f of frows as { questions?: unknown }[]) {
          let qs = f.questions;
          if (typeof qs === "string") { try { qs = JSON.parse(qs); } catch { qs = []; } }
          if (!Array.isArray(qs)) continue;
          for (const q of qs as Record<string, unknown>[]) {
            const id = String(q.id || q.label || "");
            if (id) qTypeMap.set(id, String(q.type || "text"));
          }
        }
      }
      const mediaMap = await loadMediaKindsMap(sql);

      type RowA = {
        id: number;
        date: string;
        month: string;
        user: string;
        status: string;
        /** Work status for surveyor boards: completed | pending | rejected */
        work: "completed" | "pending" | "rejected";
        draft: boolean;
        completeness: string;
        geo_ok: boolean;
        voice_ok: boolean;
        photo_ok: boolean;
        district: string;
        party: string;
      };
      type Bucket = {
        total: number;
        /** Media OK (geo+voice+photo+Q/A) */
        complete: number;
        /** Media fail */
        incomplete: number;
        /** Confirmed + not draft = finished for surveyor */
        completed: number;
        /** Alias of completed (UI uses confirmed column for completed work) */
        confirmed: number;
        /** Status pending OR draft (still open) */
        pending: number;
        rejected: number;
        draft: number;
        geo_fail: number;
        voice_fail: number;
        photo_fail: number;
      };
      const emptyBucket = (): Bucket => ({
        total: 0,
        complete: 0,
        incomplete: 0,
        completed: 0,
        confirmed: 0,
        pending: 0,
        rejected: 0,
        draft: 0,
        geo_fail: 0,
        voice_fail: 0,
        photo_fail: 0,
      });
      const bump = (b: Bucket, row: RowA) => {
        b.total += 1;
        // Media completeness
        if (row.completeness === "complete") b.complete += 1;
        else b.incomplete += 1;
        // Work progress (what Client Admin expects: completed vs pending)
        if (row.work === "completed") {
          b.completed += 1;
          b.confirmed += 1; // confirmed column = completed work
        } else if (row.work === "rejected") {
          b.rejected += 1;
        } else {
          b.pending += 1;
        }
        if (row.draft) b.draft += 1;
        if (!row.geo_ok) b.geo_fail += 1;
        if (!row.voice_ok) b.voice_fail += 1;
        if (!row.photo_ok) b.photo_fail += 1;
      };

      let list: RowA[] = [];
      for (const r of rows as { id: number; payload: unknown; created_at: string }[]) {
        const payload = parsePayload(r.payload);
        const a = (payload.answers || {}) as Record<string, unknown>;
        const v = verifyWithMedia(payload, mediaMap, Number(r.id));
        const user = surveyorNameOf(payload);
        const draft = isDraftSubmission(payload);
        const work = workStatusOf(payload);
        const date = dayKey(isoStamp(r.created_at));
        const month = date.slice(0, 7);
        if (dateFrom && date < dateFrom) continue;
        if (dateTo && date > dateTo) continue;
        if (userQ && !user.toLowerCase().includes(userQ)) continue;
        if (surveyQ && String(payload.form_key || "default") !== surveyQ) continue;
        if (districtQ && !String(a.district || "").toLowerCase().includes(districtQ)) continue;
        if (constituencyQ && !String(a.constituency || a.assembly || "").toLowerCase().includes(constituencyQ)) continue;
        let qSkip = false;
        for (const [qid, want] of qFilters) {
          const val = answerOf(a, qid);
          const hit = qTypeMap.get(qid) === "age"
            ? ageBucket(val) === want
            : Array.isArray(val)
              ? val.map(String).includes(want)
              : String(val ?? "") === want;
          if (!hit) {
            qSkip = true;
            break;
          }
        }
        if (qSkip) continue;
        // Media completeness filter (Complete / Incomplete chips)
        if (
          (completenessQ === "complete" || completenessQ === "incomplete") &&
          v.completeness !== completenessQ
        ) {
          continue;
        }
        list.push({
          id: Number(r.id),
          date,
          month,
          user,
          status: payloadStatus(payload),
          work,
          draft,
          completeness: v.completeness,
          geo_ok: v.geo_ok,
          voice_ok: v.voice_ok,
          photo_ok: v.photo_ok,
          district: String(a.district || "Unknown"),
          party: normParty(String(a.winning_party || "")),
        });
      }

      const byDate: Record<string, Bucket & { date: string }> = {};
      const byMonth: Record<string, Bucket & { month: string }> = {};
      const byUser: Record<string, Bucket & { user: string }> = {};
      const bySurveyorDay: Record<string, Bucket & { surveyor: string; day: string }> = {};
      const bySurveyorMonth: Record<string, Bucket & { surveyor: string; month: string }> = {};
      for (const row of list) {
        if (!byDate[row.date]) byDate[row.date] = { date: row.date, ...emptyBucket() };
        bump(byDate[row.date], row);

        const mk = row.month || row.date.slice(0, 7);
        if (!byMonth[mk]) byMonth[mk] = { month: mk, ...emptyBucket() };
        bump(byMonth[mk], row);

        if (!byUser[row.user]) byUser[row.user] = { user: row.user, ...emptyBucket() };
        bump(byUser[row.user], row);

        // Surveyor daily
        const sdk = `${row.user}::${row.date}`;
        if (!bySurveyorDay[sdk]) {
          bySurveyorDay[sdk] = { surveyor: row.user, day: row.date, ...emptyBucket() };
        }
        bump(bySurveyorDay[sdk], row);

        // Surveyor monthly
        const smk = `${row.user}::${mk}`;
        if (!bySurveyorMonth[smk]) {
          bySurveyorMonth[smk] = { surveyor: row.user, month: mk, ...emptyBucket() };
        }
        bump(bySurveyorMonth[smk], row);
      }

      return json({
        filters: {
          date_from: dateFrom || null,
          date_to: dateTo || null,
          user: userQ || null,
          period,
          day: dayParam || null,
          month: monthParam || null,
          completeness: completenessQ || "all",
        },
        totals: {
          records: list.length,
          // Media
          complete: list.filter((x) => x.completeness === "complete").length,
          incomplete: list.filter((x) => x.completeness === "incomplete").length,
          geo_fail: list.filter((x) => !x.geo_ok).length,
          voice_fail: list.filter((x) => !x.voice_ok).length,
          photo_fail: list.filter((x) => !x.photo_ok).length,
          // Work: completed vs pending (draft never counts completed)
          completed: list.filter((x) => x.work === "completed").length,
          confirmed: list.filter((x) => x.work === "completed").length,
          pending: list.filter((x) => x.work === "pending").length,
          rejected: list.filter((x) => x.work === "rejected").length,
          draft: list.filter((x) => x.draft).length,
          // Raw status (debug / advanced)
          status_confirmed: list.filter((x) => x.status === "confirmed").length,
          status_pending: list.filter((x) => x.status === "pending").length,
        },
        by_user: Object.values(byUser).sort(
          (a, b) =>
            Number((b as { total: number }).total) -
            Number((a as { total: number }).total),
        ),
        by_date: Object.values(byDate).sort((a, b) =>
          String((b as { date: string }).date).localeCompare(
            String((a as { date: string }).date),
          )
        ),
        by_month: Object.values(byMonth).sort((a, b) =>
          String((b as { month: string }).month).localeCompare(
            String((a as { month: string }).month),
          )
        ),
        by_day: Object.values(byDate).sort((a, b) =>
          String((b as { date: string }).date).localeCompare(
            String((a as { date: string }).date),
          )
        ),
        by_surveyor_day: Object.values(bySurveyorDay).sort((a, b) => {
          const da = a as { day: string; total: number; surveyor: string };
          const db = b as { day: string; total: number; surveyor: string };
          const d = db.day.localeCompare(da.day);
          if (d !== 0) return d;
          return db.total - da.total || da.surveyor.localeCompare(db.surveyor);
        }),
        by_surveyor_month: Object.values(bySurveyorMonth).sort((a, b) => {
          const ma = a as { month: string; total: number; surveyor: string };
          const mb = b as { month: string; total: number; surveyor: string };
          const m = mb.month.localeCompare(ma.month);
          if (m !== 0) return m;
          return mb.total - ma.total || ma.surveyor.localeCompare(mb.surveyor);
        }),
        strict: {
          geo_tagging: "required",
          voice_detection: "required",
          photo: "required",
        },
        sample: list.slice(0, 100),
      });
    }

    // Client Admin: get one submission (full payload for edit)
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})
          `
        : await sql`
            SELECT id, payload, created_at FROM submissions WHERE id = ${id}
          `;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const r = rows[0] as { id: number; payload: unknown; created_at: string };
      const payload = parsePayload(r.payload);
      const answers = (payload.answers || {}) as Record<string, unknown>;
      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;
      const verify = verifySubmission(payload, mediaKinds);
      const surveyor = surveyorNameOf(payload);
      return json({
        id: r.id,
        created_at: r.created_at,
        status: payloadStatus(payload),
        completeness: verify.completeness,
        verification: verify,
        legacy: !!verify.legacy,
        submitted_by: surveyor === "unknown" ? "" : surveyor,
        user_id: payload.user_id ?? null,
        source: payload.source || "app",
        form_id: payload.form_id || "",
        geo: payload.geo || verify.geo || null,
        has_audio: verify.voice_ok && !verify.legacy ? true : !!payload.has_audio,
        has_photo: verify.photo_ok && !verify.legacy ? true : !!payload.has_photo,
        answers,
        qa: qaFromAnswers(answers),
        edit_history: Array.isArray(payload.edit_history)
          ? payload.edit_history
          : [],
        confirmed_at: payload.confirmed_at || null,
        confirmed_by: payload.confirmed_by || null,
        proof_validated: payload.proof_validated || null,
      });
    }

    // Client Admin: EDIT survey data (answers, surveyor, geo, status)
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);

      let payload = parsePayload(rows[0].payload);
      const prevAnswers = {
        ...((payload.answers || {}) as Record<string, unknown>),
      };
      const changed: string[] = [];

      // Merge answer fields (partial update)
      if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
        const nextAns = {
          ...prevAnswers,
          ...(body.answers as Record<string, unknown>),
        };
        // Drop empty-string keys only if client sent null to clear? Keep empties as ""
        for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
          if (v === null || v === undefined) {
            delete nextAns[k];
            if (prevAnswers[k] != null) changed.push(`answers.${k}`);
          } else if (String(prevAnswers[k] ?? "") !== String(v)) {
            changed.push(`answers.${k}`);
          }
        }
        payload.answers = nextAns;
      }

      if (body.submitted_by != null && String(body.submitted_by).trim()) {
        const sb = String(body.submitted_by).trim();
        if (String(payload.submitted_by || "") !== sb) {
          changed.push("submitted_by");
          payload.submitted_by = sb;
        }
        const ans = (payload.answers || {}) as Record<string, unknown>;
        ans.data_collector = sb;
        payload.answers = ans;
      }

      // Optional geo fix by Client Admin
      if (body.geo && typeof body.geo === "object") {
        const g = body.geo as Record<string, unknown>;
        const lat = Number(g.lat ?? g.latitude);
        const lng = Number(g.lng ?? g.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          payload.geo = {
            lat,
            lng,
            accuracy: g.accuracy != null ? Number(g.accuracy) : null,
            at: g.at || new Date().toISOString(),
            source: "admin_edit",
          };
          changed.push("geo");
        }
      }

      // Media flags override (admin may mark present after offline repair)
      if (body.has_audio === true) {
        payload.has_audio = true;
        changed.push("has_audio");
      }
      if (body.has_photo === true) {
        payload.has_photo = true;
        changed.push("has_photo");
      }
      if (body.has_audio === false) {
        payload.has_audio = false;
        changed.push("has_audio");
      }
      if (body.has_photo === false) {
        payload.has_photo = false;
        changed.push("has_photo");
      }

      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;

      const verify = verifySubmission(payload, mediaKinds);
      payload.completeness = verify.completeness;
      payload.verification = verify;

      // Optional status change in same edit
      if (body.status != null && String(body.status).trim()) {
        const next = String(body.status).toLowerCase().trim();
        if (!["confirmed", "rejected", "pending"].includes(next)) {
          return json({ error: "status must be confirmed | rejected | pending" }, 400);
        }
        const force = body.force === true;
        if (next === "confirmed" && verify.completeness !== "complete" && !force) {
          return json({
            error: "Strict verification failed — cannot confirm incomplete record",
            completeness: "incomplete",
            verification: verify,
            hint: "Fix answers/geo/voice/photo first, or pass force:true.",
          }, 422);
        }
        if (payloadStatus(payload) !== next) changed.push("status");
        if (next === "confirmed") payload = translateGeoEnglish(payload);
        payload.status = next;
        payload.confirmed_at = next === "pending" ? null : new Date().toISOString();
        payload.confirmed_by = next === "pending" ? null : me.name || me.username;
        payload.confirm_note = body.note || payload.confirm_note || null;
        if (next === "confirmed" && force) payload.force_confirm = true;
      }

      if (!changed.length && body.answers == null && body.geo == null && body.status == null) {
        return json({ error: "Nothing to update — send answers, geo, submitted_by, or status" }, 400);
      }

      const history = Array.isArray(payload.edit_history)
        ? [...(payload.edit_history as unknown[])]
        : [];
      history.unshift({
        at: new Date().toISOString(),
        by: me.name || me.username,
        fields: changed.length ? changed : ["answers"],
        note: body.note ? String(body.note).slice(0, 500) : null,
      });
      payload.edit_history = history.slice(0, 50);
      payload.updated_at = new Date().toISOString();
      payload.updated_by = me.name || me.username;

      await sql`
        UPDATE submissions
        SET payload = ${JSON.stringify(payload)}::jsonb
        WHERE id = ${id}
      `;

      // Fact layer: keep facts in sync when status is edited from the edit screen
      // (guard mirrors the status-change block above — empty status must not touch facts)
      if (body.status != null && String(body.status).trim()) {
        const s2 = String(body.status).toLowerCase().trim();
        if (s2 === "confirmed") {
          try {
            await materializeFact(sql, id);
          } catch (e) {
            await markFactFailed(sql, id, e);
          }
        } else {
          await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
          await sql`UPDATE submissions SET fact_status = NULL, fact_error = NULL WHERE id = ${id}`.catch(() => null);
        }
      }

      const answers = (payload.answers || {}) as Record<string, unknown>;
      return json({
        ok: true,
        id,
        status: payloadStatus(payload),
        completeness: verify.completeness,
        verification: verify,
        submitted_by: payload.submitted_by || answers.data_collector || "",
        answers,
        qa: qaFromAnswers(answers),
        changed,
        updated_by: payload.updated_by,
        updated_at: payload.updated_at,
      });
    }

    // Client Admin: DELETE survey record
    if (path.match(/^\/api\/submissions\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`SELECT id FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      await sql`DELETE FROM survey_media WHERE submission_id = ${id}`.catch(() => null);
      await sql`DELETE FROM submissions WHERE id = ${id}`;
      return json({
        ok: true,
        id,
        deleted: true,
        deleted_by: me.name || me.username,
      });
    }

    // Confirm / reject — strict: complete only (unless force)
    if (path.match(/^\/api\/submissions\/\d+\/status$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const next = String(body.status || "").toLowerCase();
      const force = body.force === true;
      if (!["confirmed", "rejected", "pending"].includes(next)) {
        return json({ error: "status must be confirmed | rejected | pending" }, 400);
      }
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      let payload = parsePayload(rows[0].payload);
      const mediaKinds = (
        await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
      ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
      if (mediaKinds.includes("audio")) payload.has_audio = true;
      if (mediaKinds.includes("photo")) payload.has_photo = true;
      const verify = verifySubmission(payload, mediaKinds);

      if (next === "confirmed" && verify.completeness !== "complete" && !force) {
        return json({
          error: "Strict verification failed — cannot confirm incomplete record",
          completeness: "incomplete",
          verification: verify,
          hint: "Needs valid geo tag + voice (audio) + photo + Q/A. Pass force:true only if Client Admin overrides.",
        }, 422);
      }

      if (next === "confirmed") payload = translateGeoEnglish(payload);

      // Confirming a final survey clears draft tags so it counts as completed work
      if (next === "confirmed") {
        payload.draft = false;
        const ans = { ...((payload.answers || {}) as Record<string, unknown>) };
        delete ans._draft;
        delete ans.draft;
        payload.answers = ans;
      }

      payload = {
        ...payload,
        status: next,
        completeness: verify.completeness,
        verification: verify,
        has_audio: verify.voice_ok ? true : payload.has_audio,
        has_photo: verify.photo_ok ? true : payload.has_photo,
        confirmed_at: next === "pending" ? null : new Date().toISOString(),
        confirmed_by: next === "pending" ? null : me.name || me.username,
        confirm_note: body.note || null,
        force_confirm: next === "confirmed" && force ? true : undefined,
      };
      await sql`
        UPDATE submissions
        SET payload = ${JSON.stringify(payload)}::jsonb
        WHERE id = ${id}
      `;

      // Fact layer: confirmed → materialize (idempotent); pending/rejected → never in analytics
      if (next === "confirmed") {
        try {
          await materializeFact(sql, id);
        } catch (e) {
          await markFactFailed(sql, id, e);
        }
      } else {
        await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
        await sql`UPDATE submissions SET fact_status = NULL, fact_error = NULL WHERE id = ${id}`.catch(() => null);
      }

      logAudit(me, "submission_status", "submission", id, { status: next, force });
      return json({
        ok: true,
        id,
        status: next,
        completeness: verify.completeness,
        verification: verify,
        confirmed_by: payload.confirmed_by,
        confirmed_at: payload.confirmed_at,
      });
    }

    // Proof validation — phone number + Aadhaar format check on a record (grantable power)
    if (path.match(/^\/api\/submissions\/\d+\/proof$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_validate_proof")) {
        return json({
          error: "Super Admin has not granted your account proof-validation rights (phone + Aadhaar)",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const payload = parsePayload(rows[0].payload);
      const answers = ((payload.answers || {}) as Record<string, unknown>);

      // Find proof fields by common key names (case-insensitive, underscore-boundary match
      // so e.g. "uuid"/"guid" never get treated as Aadhaar)
      let phoneRaw = "";
      let aadhaarRaw = "";
      const phoneKeys = ["phone", "mobile", "phone_number", "contact", "contact_number", "mobile_number"];
      const aadhaarKeys = ["aadhaar", "aadhaar_no", "aadhaar_number", "uid", "aadhaar_id", "id_proof"];
      const norm = (s: string) => String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
      const matchesKey = (key: string, known: string) => {
        const k = norm(known);
        return key === k || key.startsWith(k + "_") || key.endsWith("_" + k);
      };
      for (const [k, v] of Object.entries(answers)) {
        const key = norm(k);
        const val = v == null ? "" : String(v);
        if (!phoneRaw && phoneKeys.some((pk) => matchesKey(key, pk))) phoneRaw = val;
        if (!aadhaarRaw && aadhaarKeys.some((ak) => matchesKey(key, ak))) aadhaarRaw = val;
      }

      // Strip separators and optional +91 / 91 country prefix before checking
      const strip = (s: string) =>
        String(s).replace(/[\s\-().]/g, "").replace(/^\+?91/, "");
      const phone = strip(phoneRaw);
      const aadhaar = strip(aadhaarRaw);
      const phoneValid = /^[6-9]\d{9}$/.test(phone); // Indian mobile: 10 digits, starts 6-9
      const aadhaarValid = /^\d{12}$/.test(aadhaar); // Aadhaar: 12 digits

      const anyFound = !!phoneRaw || !!aadhaarRaw;
      const result = {
        phone: {
          found: !!phoneRaw,
          value: phoneRaw || null,
          valid: phoneValid,
        },
        aadhaar: {
          found: !!aadhaarRaw,
          value: aadhaarRaw || null,
          valid: aadhaarValid,
        },
        all_valid: (!phoneRaw || phoneValid) && (!aadhaarRaw || aadhaarValid),
      };
      // Only mark proof-validated when at least one proof field exists and all present ones pass
      const proofValidated = anyFound && result.all_valid;

      payload.proof_validated = {
        ok: proofValidated,
        phone: result.phone,
        aadhaar: result.aadhaar,
        checked_at: new Date().toISOString(),
        checked_by: me.name || me.username,
        note: body.note ? String(body.note).slice(0, 500) : null,
      };
      await sql`
        UPDATE submissions
        SET payload = ${JSON.stringify(payload)}::jsonb
        WHERE id = ${id}
      `;

      logAudit(me, "proof_validation", "submission", id, {
        phone_valid: result.phone.valid,
        aadhaar_valid: result.aadhaar.valid,
        ok: proofValidated,
        note: (payload.proof_validated as Record<string, unknown>)?.note ?? null,
      });
      return json({ ok: true, id, ...result, proof_validated: payload.proof_validated });
    }

    // Bulk confirm all pending (bootstrap / after review)
    if (path === "/api/submissions/confirm-pending" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_review_data")) {
        return json({
          error: "Super Admin has not granted your account data-verification rights",
        }, 403);
      }
      const body = await readBody(req);
      const max = Math.min(Number(body.limit) || 500, 2000);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const rows = scopeKeys
        ? await sql`
            SELECT id, payload FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT ${max}
          `
        : await sql`
            SELECT id, payload FROM submissions ORDER BY created_at DESC LIMIT ${max}
          `;
      let n = 0;
      const who = me.name || me.username;
      const when = new Date().toISOString();
      for (const r of rows as { id: number; payload: Record<string, unknown> }[]) {
        let payload = r.payload;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = {};
          }
        }
        if (payloadStatus(payload) !== "pending") continue;
        payload = translateGeoEnglish(payload);
        payload = {
          ...payload,
          status: "confirmed",
          confirmed_at: when,
          confirmed_by: who,
          confirm_note: body.note || "bulk confirm",
        };
        await sql`
          UPDATE submissions SET payload = ${JSON.stringify(payload)}::jsonb WHERE id = ${r.id}
        `;
        try {
          await materializeFact(sql, r.id);
        } catch (e) {
          await markFactFailed(sql, r.id, e);
        }
        n += 1;
      }
      return json({ ok: true, confirmed: n });
    }

    // Client Admin: retry fact materialization for a failed record (FR-PRC-04)
    if (path.match(/^\/api\/submissions\/\d+\/retry-fact$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const scopeKeys = await adminFormKeyScope(sql, me);
      const row = scopeKeys
        ? await sql`SELECT id FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id FROM submissions WHERE id = ${id}`;
      if (!row.length) return json({ error: "Not found" }, 404);
      try {
        const res = await materializeFact(sql, id);
        return json({ ok: true, ...res, status: "materialized" });
      } catch (e) {
        await markFactFailed(sql, id, e);
        return json({
          ok: false,
          error: "Fact materialization failed",
          detail: String((e as Error)?.message || e),
        }, 422);
      }
    }

    // ── Surveys (multi-survey: name + own questions + team + respondents) ────
    if (path === "/api/surveys" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      // Projects are scoped to their owner, plus explicit Client Admin project access.
      // Surveyor assignments remain a separate Client-Admin-only concern.
      const rows = me.role === "super_admin"
        ? await sql`SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form ORDER BY title`
        : await sql`
            SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form
            WHERE created_by = ${me.id}
               OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
            ORDER BY title
          `;
      // Project → Client Admin connections for the Super Admin project list.
      const adminAccess = await sql`
        SELECT saa.survey_id, u.id, u.username, COALESCE(u.display_name, u.username) AS name,
               u.company_name
        FROM survey_admin_access saa JOIN app_users u ON u.id = saa.admin_id
        ORDER BY u.username
      `.catch(() => []);
      const adminAccessMap = new Map<number, { id: number; username: string; name: string; company_name: string | null }[]>();
      for (const a of adminAccess as { survey_id: number; id: number; username: string; name: string; company_name: string | null }[]) {
        const arr = adminAccessMap.get(Number(a.survey_id)) || [];
        arr.push({ id: Number(a.id), username: a.username, name: a.name, company_name: a.company_name || null });
        adminAccessMap.set(Number(a.survey_id), arr);
      }
      const adminRows = await sql`
        SELECT id, COALESCE(display_name, username) AS name, company_name FROM app_users WHERE role = 'admin'
      `.catch(() => []);
      const adminById = new Map<number, { name: string; company_name: string | null }>();
      for (const a of adminRows as { id: number; name: string; company_name: string | null }[]) {
        adminById.set(Number(a.id), { name: String(a.name), company_name: a.company_name || null });
      }
      const asg = await sql`
        SELECT a.survey_id, COUNT(*)::int AS n,
               ARRAY_AGG(DISTINCT COALESCE(u.name, u.username)) AS names
        FROM survey_assignments a
        JOIN users u ON a.user_id = u.id
        GROUP BY a.survey_id
      `.catch(async () =>
        await sql`
          SELECT survey_id, COUNT(*)::int AS n, NULL AS names
          FROM survey_assignments GROUP BY survey_id
        `.catch(() => [])
      );
      const rsp = await sql`
        SELECT survey_id, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'done')::int AS done
        FROM survey_respondents GROUP BY survey_id
      `.catch(() => []);
      const sub = await sql`
        SELECT payload->>'form_key' AS fk, COUNT(*)::int AS n FROM submissions GROUP BY payload->>'form_key'
      `.catch(() => []);
      const asgMap = new Map(asg.map((r) => [Number((r as { survey_id: number }).survey_id), r as { n: number; names?: string[] }]));
      const rspMap = new Map(rsp.map((r) => [Number((r as { survey_id: number }).survey_id), r as { total: number; done: number }]));
      const subMap = new Map(sub.map((r) => [String((r as { fk: string }).fk), (r as { n: number }).n]));
      const items = (rows as Record<string, unknown>[]).map((r) => {
        let qs = r.questions;
        if (typeof qs === "string") {
          try { qs = JSON.parse(qs); } catch { qs = []; }
        }
        const asgData = asgMap.get(Number(r.id));
        const names = Array.isArray(asgData?.names) ? asgData.names.filter(Boolean) : [];
        const connectedAdmins = adminAccessMap.get(Number(r.id)) || [];
        const ownerId = r.created_by != null ? Number(r.created_by) : null;
        const owner = ownerId != null ? adminById.get(ownerId) : undefined;
        const admins = owner && !connectedAdmins.some((a) => a.id === ownerId)
          ? [{ id: ownerId, username: '', name: owner.name, company_name: owner.company_name }, ...connectedAdmins]
          : connectedAdmins;
        return {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          company_name: r.company_name || null,
          owner_company: owner?.company_name ?? null,
          owner_name: owner?.name ?? null,
          question_count: Array.isArray(qs) ? qs.length : 0,
          updated_at: r.updated_at,
          surveyors: asgData?.n || 0,
          surveyor_names: names.join(", ") || "",
          admin_count: admins.length,
          admin_names: admins.map((a) => `${a.company_name || 'No company'} · ${a.name}`).join(", "),
          respondents_total: rspMap.get(Number(r.id))?.total || 0,
          respondents_done: rspMap.get(Number(r.id))?.done || 0,
          submissions: subMap.get(String(r.form_key)) || 0,
        };
      });
      const filtered = q
        ? items.filter((s) => String(s.title || "").toLowerCase().includes(q))
        : items;
      return json({ items: filtered, count: filtered.length });
    }

    if (path === "/api/surveys" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account questionnaire-editing rights",
        }, 403);
      }
      const body = await readBody(req);
      const title = String(body.title || "").trim();
      if (!title) return json({ error: "Survey name required" }, 400);
      const questions = Array.isArray(body.questions) ? body.questions : [];
      // Super Admin registers the company this project is mapped under + the Client
      // Admins who are part of it (they get project access; the Super Admin stays owner).
      let companyName: string | null = null;
      let connectedAdminIds: number[] = [];
      if (me.role === "super_admin") {
        companyName = String(body.company_name || "").trim().slice(0, 160) || null;
        if (companyName && sql) {
          const comp = await ensureCompanyExists(sql, companyName, me.id);
          if (comp) companyName = comp.name;
        }
        connectedAdminIds = [...new Set(
          (Array.isArray(body.admin_ids) ? body.admin_ids : [])
            .map(Number)
            .filter((v: number) => Number.isFinite(v)),
        )];
        if (connectedAdminIds.length) {
          const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${connectedAdminIds})`.catch(() => []);
          const validIds = new Set((valid as { id: number }[]).map((r) => Number(r.id)));
          if (validIds.size !== connectedAdminIds.length) {
            return json({ error: "Only Client Admin accounts can be connected" }, 422);
          }
        }
      } else {
        companyName = (me as Record<string, unknown>).company_name
          ? String((me as Record<string, unknown>).company_name).trim().slice(0, 160)
          : null;
        if (companyName && sql) {
          const comp = await ensureCompanyExists(sql, companyName, me.id);
          if (comp) companyName = comp.name;
        }
      }
      // Super-Admin-set per-survey question cap for this Client Admin (0 = unlimited)
      const maxQsCreate = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
      if (maxQsCreate > 0 && questions.length > maxQsCreate) {
        return json({
          error: `Survey question cap exceeded — maximum ${maxQsCreate} questions per survey (set by Super Admin)`,
        }, 422);
      }
      const dup = await sql`
        SELECT id, form_key FROM survey_form WHERE LOWER(title) = LOWER(${title}) LIMIT 1
      `.catch(() => []);
      if (dup.length) {
        const d = dup[0] as { id: number; form_key: string };
        return json({
          error: `Survey "${title}" already exists`,
          existing_id: d.id,
          form_key: d.form_key,
        }, 409);
      }
      // Super-Admin-set cap on how many surveys this Client Admin may create (0 = unlimited)
      const maxSvCreate = Number((me as Record<string, unknown>).max_surveys) || 0;
      if (maxSvCreate > 0) {
        const mine = await sql`SELECT COUNT(*)::int AS n FROM survey_form WHERE created_by = ${me.id}`.catch(() => [{ n: 0 }]);
        const createdCount = Number((mine[0] as { n?: number })?.n || 0);
        if (createdCount >= maxSvCreate) {
          return json({
            error: `Survey limit reached — maximum ${maxSvCreate} surveys (set by Super Admin). Delete or edit an existing survey first.`,
          }, 422);
        }
      }
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "survey";
      let formKey = base;
      let n = 1;
      for (;;) {
        const clash = await sql`SELECT id FROM survey_form WHERE form_key = ${formKey} LIMIT 1`;
        if (!clash.length) break;
        n += 1;
        formKey = `${base}-${n}`;
      }
      const rows = await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at, created_by, company_name)
        VALUES (${formKey}, ${title}, ${JSON.stringify(questions)}::jsonb, NOW(), ${me.id}, ${companyName})
        RETURNING id, form_key, title, updated_at
      `;
      const surveyId = (rows[0] as { id?: unknown }).id;
      // The registered Client Admins are part of this project (shared access).
      if (me.role === "super_admin" && connectedAdminIds.length) {
        for (const adminId of connectedAdminIds) {
          await sql`INSERT INTO survey_admin_access (survey_id, admin_id) VALUES (${surveyId}, ${adminId}) ON CONFLICT DO NOTHING`.catch(() => null);
        }
      }
      logAudit(me, "survey_create", "survey", surveyId, {
        title,
        form_key: formKey,
        questions: questions.length,
        company_name: companyName,
        admin_ids: connectedAdminIds,
      });
      return json({ ok: true, survey: rows[0] }, 201);
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      // Client Admin can open only owned or explicitly assigned projects.
      const rows = me.role === "super_admin"
        ? await sql`SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form WHERE id = ${id}`
        : await sql`
            SELECT id, form_key, title, questions, updated_at, created_by, company_name FROM survey_form
            WHERE id = ${id} AND (
              created_by = ${me.id}
              OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id})
            )
          `;
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      const r = rows[0] as { id: number; form_key: string; title: string; questions: unknown; updated_at: string; created_by: number | null; company_name: string | null };
      let questions = r.questions;
      if (typeof questions === "string") {
        try { questions = JSON.parse(questions); } catch { questions = []; }
      }
      const team = me.role === "super_admin"
        ? await sql`
        SELECT u.id, u.username, u.display_name, u.active
        FROM survey_assignments sa JOIN app_users u ON u.id = sa.user_id
        WHERE sa.survey_id = ${id} ORDER BY u.username
      `.catch(() => [])
        : await sql`
        SELECT u.id, u.username, u.display_name, u.active
        FROM survey_assignments sa JOIN app_users u ON u.id = sa.user_id
        WHERE sa.survey_id = ${id} AND u.created_by = ${me.id} ORDER BY u.username
      `.catch(() => []);
      const respondents = await sql`
        SELECT id, name, phone, status, done_at, submission_id, created_at
        FROM survey_respondents WHERE survey_id = ${id} ORDER BY id DESC
      `.catch(() => []);
      const adminRows = await sql`
        SELECT u.id, u.username, u.display_name, u.company_name
        FROM app_users u
        WHERE u.id = ${r.created_by}
        UNION
        SELECT u.id, u.username, u.display_name, u.company_name
        FROM survey_admin_access saa JOIN app_users u ON u.id = saa.admin_id
        WHERE saa.survey_id = ${id}
        ORDER BY username
      `.catch(() => []);
      const admins = (adminRows as Record<string, unknown>[]).map((a) => ({
        id: a.id, username: a.username, name: a.display_name || a.username,
        company_name: a.company_name || null,
      }));
      const owner = admins.find((a) => Number(a.id) === Number(r.created_by));
      return json({
        survey: {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          questions,
          updated_at: r.updated_at,
          surveyors: team,
          respondents,
          owner_id: r.created_by,
          owner: owner ? `${owner.name}${owner.company_name ? ` · ${owner.company_name}` : ""}` : null,
          company_name: r.company_name || null,
          admins,
          admin_count: admins.length,
        },
      });
    }

    // Super Admin connects Client Admin accounts to a project. This endpoint
    // intentionally never touches survey_assignments (the surveyor team).
    if (path.match(/^\/api\/surveys\/\d+\/admins$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const requestedIds = [...new Set((Array.isArray(body.admin_ids) ? body.admin_ids : [])
        .map(Number).filter((value: number) => Number.isFinite(value)))];
      const project = await sql`SELECT id, created_by FROM survey_form WHERE id = ${id}`.catch(() => []);
      if (!project.length) return json({ error: "Project not found" }, 404);
      const ownerId = Number((project[0] as { created_by?: unknown }).created_by) || null;
      const ids = requestedIds.filter((adminId) => adminId !== ownerId);
      if (ids.length) {
        const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${ids})`.catch(() => []);
        const validIds = new Set((valid as { id: number }[]).map((row) => Number(row.id)));
        if (validIds.size !== ids.length) return json({ error: "Only Client Admin accounts can be connected" }, 422);
      }
      await sql`DELETE FROM survey_admin_access WHERE survey_id = ${id}`;
      for (const adminId of ids) {
        await sql`INSERT INTO survey_admin_access (survey_id, admin_id) VALUES (${id}, ${adminId}) ON CONFLICT DO NOTHING`;
      }
      logAudit(me, "project_client_admins_update", "survey", id, { admin_ids: ids });
      return json({ ok: true, connected: ids.length });
    }

    // ── Companies registry (Super Admin creates companies, adds Client Admins) ──
    if (path === "/api/companies" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const rows = await sql`
        SELECT c.id, c.name, c.created_at, c.created_by,
               COALESCE(u.display_name, u.username) AS created_by_name
        FROM companies c
        LEFT JOIN app_users u ON u.id = c.created_by
        ORDER BY c.name
      `.catch(() => []);
      const memberRows = await sql`
        SELECT u.company_id AS cid, u.id, u.username,
               COALESCE(u.display_name, u.username) AS name
        FROM app_users u
        WHERE u.company_id IS NOT NULL
        ORDER BY u.username
      `.catch(() => []);
      const memberMap = new Map<number, { id: number; username: string; name: string }[]>();
      for (const m of memberRows as { cid: number; id: number; username: string; name: string }[]) {
        const arr = memberMap.get(Number(m.cid)) || [];
        arr.push({ id: Number(m.id), username: String(m.username), name: String(m.name) });
        memberMap.set(Number(m.cid), arr);
      }
      const projectRows = await sql`
        SELECT LOWER(company_name) AS key, COUNT(*)::int AS n
        FROM survey_form
        WHERE company_name IS NOT NULL AND company_name <> ''
        GROUP BY LOWER(company_name)
      `.catch(() => []);
      const projectMap = new Map<string, number>();
      for (const p of projectRows as { key: string; n: number }[]) {
        projectMap.set(String(p.key), Number(p.n));
      }
      const items = (rows as Record<string, unknown>[]).map((c) => ({
        id: c.id,
        name: c.name,
        created_at: c.created_at,
        created_by_name: c.created_by_name || null,
        admins: memberMap.get(Number(c.id)) || [],
        admin_count: (memberMap.get(Number(c.id)) || []).length,
        project_count: projectMap.get(String(c.name).toLowerCase()) || 0,
      }));
      return json({ items, count: items.length });
    }

    if (path === "/api/companies" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 160);
      if (!name) return json({ error: "Company name required" }, 400);
      const dup = await sql`SELECT id FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1`.catch(() => []);
      if (dup.length) return json({ error: `Company "${name}" already exists` }, 409);
      let rows;
      try {
        rows = await sql`
          INSERT INTO companies (name, created_by) VALUES (${name}, ${me.id})
          RETURNING id, name, created_at
        `;
      } catch (err) {
        const msg = (err as Error).message || "";
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return json({ error: `Company "${name}" already exists` }, 409);
        }
        return json({ error: msg || "Could not create company" }, 500);
      }
      const c = rows[0] as { id: number; name: string; created_at: string } | undefined;
      if (!c) return json({ error: "Could not create company" }, 500);
      await sql`
        UPDATE app_users
        SET company_id = ${c.id}, company_name = ${c.name}
        WHERE LOWER(company_name) = LOWER(${c.name}) AND (company_id IS NULL OR company_id <> ${c.id})
      `.catch(() => null);
      logAudit(me, "company_create", "company", c.id, { name });
      return json({ company: c }, 201);
    }

    if (path.match(/^\/api\/companies\/\d+$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 160);
      if (!name) return json({ error: "Company name required" }, 400);
      const ex = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
      if (!ex.length) return json({ error: "Company not found" }, 404);
      const oldName = String((ex[0] as { name: string }).name);
      const dup = await sql`SELECT id FROM companies WHERE LOWER(name) = LOWER(${name}) AND id <> ${id} LIMIT 1`.catch(() => []);
      if (dup.length) return json({ error: `Company "${name}" already exists` }, 409);
      await sql`UPDATE companies SET name = ${name} WHERE id = ${id}`;
      // Keep member profiles in sync so the admin list/profile show the new name.
      await sql`UPDATE app_users SET company_name = ${name} WHERE company_id = ${id}`.catch(() => null);
      logAudit(me, "company_rename", "company", id, { from: oldName, to: name });
      return json({ ok: true, name });
    }

    if (path.match(/^\/api\/companies\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const ex = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
      if (!ex.length) return json({ error: "Company not found" }, 404);
      const name = String((ex[0] as { name: string }).name);
      // Unlink member Client Admins; keep their profile name only if it differs.
      await sql`
        UPDATE app_users SET company_id = NULL,
          company_name = CASE WHEN company_name = ${name} THEN NULL ELSE company_name END
        WHERE company_id = ${id}
      `.catch(() => null);
      await sql`DELETE FROM companies WHERE id = ${id}`;
      logAudit(me, "company_delete", "company", id, { name });
      return json({ ok: true, deleted: true });
    }

    // Replace which Client Admins belong to a company (they become "part of it").
    if (path.match(/^\/api\/companies\/\d+\/admins$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "super_admin") return json({ error: "Super Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const company = await sql`SELECT id, name FROM companies WHERE id = ${id}`.catch(() => []);
      if (!company.length) return json({ error: "Company not found" }, 404);
      const companyName = String((company[0] as { name: string }).name);
      const requestedIds = [...new Set((Array.isArray(body.admin_ids) ? body.admin_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v)))];
      if (requestedIds.length) {
        const valid = await sql`SELECT id FROM app_users WHERE role = 'admin' AND id = ANY(${requestedIds})`.catch(() => []);
        const validIds = new Set((valid as { id: number }[]).map((r) => Number(r.id)));
        if (validIds.size !== requestedIds.length) {
          return json({ error: "Only Client Admin accounts can be added to a company" }, 422);
        }
      }
      // Unlink everyone, then link the requested set (company_name stays in sync).
      await sql`
        UPDATE app_users SET company_id = NULL,
          company_name = CASE WHEN company_name = ${companyName} THEN NULL ELSE company_name END
        WHERE company_id = ${id}
      `.catch(() => null);
      if (requestedIds.length) {
        await sql`
          UPDATE app_users SET company_id = ${id}, company_name = ${companyName}
          WHERE id = ANY(${requestedIds})
        `.catch(() => null);
      }
      logAudit(me, "company_admins_update", "company", id, { admin_ids: requestedIds });
      return json({ ok: true, connected: requestedIds.length });
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account questionnaire-editing rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      // Connected Client Admins may edit the project, while only the owner (or
      // Super Admin) can delete it.
      const rows = me.role === "super_admin"
        ? await sql`SELECT id, title FROM survey_form WHERE id = ${id}`
        : await sql`
            SELECT id, title FROM survey_form
            WHERE id = ${id} AND (created_by = ${me.id}
              OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id}))
          `;
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      // Super-Admin-set per-survey question cap for this Client Admin (0 = unlimited)
      const maxQsPut = Number((me as Record<string, unknown>).max_questions_per_survey) || 0;
      if (maxQsPut > 0 && Array.isArray(body.questions) && body.questions.length > maxQsPut) {
        return json({
          error: `Survey question cap exceeded — maximum ${maxQsPut} questions per survey (set by Super Admin)`,
        }, 422);
      }
      const title = String(body.title || "").trim();
      if (title) {
        const dup = await sql`
          SELECT id FROM survey_form
          WHERE LOWER(title) = LOWER(${title}) AND id <> ${id} LIMIT 1
        `.catch(() => []);
        if (dup.length) return json({ error: `Survey "${title}" already exists` }, 409);
      }
      if (title) {
        await sql`
          UPDATE survey_form SET title = ${title}, updated_at = NOW() WHERE id = ${id}
        `;
      }
      if (Array.isArray(body.questions)) {
        await sql`
          UPDATE survey_form SET questions = ${JSON.stringify(body.questions)}::jsonb, updated_at = NOW()
          WHERE id = ${id}
        `;
      }
      // The company a project is mapped under is registered by the Super Admin.
      let nextCompanyName: string | null | undefined;
      if (me.role === "super_admin" && body.company_name !== undefined) {
        nextCompanyName = String(body.company_name || "").trim().slice(0, 160) || null;
        if (nextCompanyName && sql) {
          const comp = await ensureCompanyExists(sql, nextCompanyName, me.id);
          if (comp) nextCompanyName = comp.name;
        }
        await sql`
          UPDATE survey_form SET company_name = ${nextCompanyName}, updated_at = NOW() WHERE id = ${id}
        `;
      }
      logAudit(me, "survey_update", "survey", id, {
        title: title || undefined,
        company_name: nextCompanyName === undefined ? undefined : nextCompanyName,
      });
      return json({ ok: true });
    }

    if (path.match(/^\/api\/surveys\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_crud_questionnaire") && !hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account questionnaire-editing rights",
        }, 403);
      }
      const id = Number(path.split("/")[3]);
      // Only the owner (or Super Admin) may delete — shared access does NOT grant
      // delete rights, so one admin can't remove a survey others rely on.
      const rows = me.role === "super_admin"
        ? await sql`SELECT form_key FROM survey_form WHERE id = ${id}`
        : await sql`SELECT form_key FROM survey_form WHERE id = ${id} AND created_by = ${me.id}`;
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      await sql`DELETE FROM survey_assignments WHERE survey_id = ${id}`.catch(() => null);
      await sql`DELETE FROM survey_respondents WHERE survey_id = ${id}`.catch(() => null);
      await sql`DELETE FROM survey_form WHERE id = ${id}`;
      logAudit(me, "survey_delete", "survey", id, { form_key: (rows[0] as { form_key: string }).form_key });
      return json({ ok: true, deleted: true });
    }

    // Replace the surveyor team for a survey
    if (path.match(/^\/api\/surveys\/\d+\/surveyors$/) && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (me.role === "super_admin") {
        return json({ error: "Super Admin connects Client Admins to projects; surveyors are managed only by the Client Admin." }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const ids = (Array.isArray(body.user_ids) ? body.user_ids : [])
        .map(Number)
        .filter((v: number) => Number.isFinite(v));
      // A Client Admin maps only their own surveyors to owned or assigned projects.
      const rows = await sql`
        SELECT id FROM survey_form
        WHERE id = ${id} AND (created_by = ${me.id}
          OR id IN (SELECT survey_id FROM survey_admin_access WHERE admin_id = ${me.id}))
      `;
      if (!rows.length) return json({ error: "Not found or not your survey" }, 404);
      // Only allow mapping surveyors this admin created (or admin/super_admin accounts)
      let allowed: number[] = ids;
      if (me.role !== "super_admin" && ids.length) {
        const ok = await sql`
          SELECT id FROM app_users
          WHERE id = ANY(${ids}) AND (created_by = ${me.id} OR role = 'admin' OR role = 'super_admin')
        `.catch(() => []);
        const okSet = new Set((ok as { id: number }[]).map((r) => Number(r.id)));
        allowed = ids.filter((v) => okSet.has(v));
      }
      await sql`
        DELETE FROM survey_assignments
        WHERE survey_id = ${id} AND user_id IN (
          SELECT id FROM app_users WHERE created_by = ${me.id} AND role = 'surveyor'
        )
      `.catch(() => null);
      for (const uid of allowed) {
        await sql`
          INSERT INTO survey_assignments (survey_id, user_id)
          VALUES (${id}, ${uid})
          ON CONFLICT (survey_id, user_id) DO NOTHING
        `.catch(() => null);
      }
      return json({ ok: true, assigned: allowed.length });
    }

    // Surveyor view: surveys assigned to me (with their questions) — field app
    if (path === "/api/my-surveys" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "surveyor" && me.role !== "admin") {
        return json({ error: "Forbidden" }, 403);
      }
      const rows = await sql`
        SELECT f.id, f.form_key, f.title, f.questions, f.updated_at
        FROM survey_assignments sa
        JOIN survey_form f ON f.id = sa.survey_id
        WHERE sa.user_id = ${me.id}
        ORDER BY f.title
      `.catch(() => []);
      const items = (rows as Record<string, unknown>[]).map((r) => {
        let qs = r.questions;
        if (typeof qs === "string") {
          try { qs = JSON.parse(qs); } catch { qs = []; }
        }
        return {
          id: r.id,
          form_key: r.form_key,
          title: r.title,
          questions: Array.isArray(qs) ? qs : [],
          updated_at: r.updated_at,
        };
      });
      return json({ items, count: items.length });
    }

    // Respondents per survey
    if (path.match(/^\/api\/surveys\/\d+\/respondents$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "Name required" }, 400);
      const rows = await sql`
        INSERT INTO survey_respondents (survey_id, name, phone)
        VALUES (${id}, ${name}, ${String(body.phone || "").trim() || null})
        RETURNING id, name, phone, status, created_at
      `;
      return json({ ok: true, respondent: rows[0] }, 201);
    }

    if (path.match(/^\/api\/surveys\/\d+\/respondents\/\d+$/) && method === "PATCH") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      const body = await readBody(req);
      const status = String(body.status || "").toLowerCase();
      if (status === "done") {
        await sql`
          UPDATE survey_respondents SET status = 'done', done_at = NOW()
          WHERE id = ${Number(path.split("/")[5])} AND survey_id = ${Number(path.split("/")[3])}
        `;
      } else if (status === "pending") {
        await sql`
          UPDATE survey_respondents SET status = 'pending', done_at = NULL
          WHERE id = ${Number(path.split("/")[5])} AND survey_id = ${Number(path.split("/")[3])}
        `;
      }
      return json({ ok: true });
    }

    if (path.match(/^\/api\/surveys\/\d+\/respondents\/\d+$/) && method === "DELETE") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      await sql`
        DELETE FROM survey_respondents
        WHERE id = ${Number(path.split("/")[5])} AND survey_id = ${Number(path.split("/")[3])}
      `;
      return json({ ok: true, deleted: true });
    }

    // ── Dynamic questions (field app loads automatically) ───
    if (path === "/api/questions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      try {
        const rows = await sql`
          SELECT form_key, title, questions, updated_at
          FROM survey_form WHERE form_key = 'default' LIMIT 1
        `;
        if (!rows.length) {
          return json({
            form_key: "default",
            title: "Field Survey",
            questions: DEFAULT_QUESTIONS,
            updated_at: null,
          });
        }
        const f = rows[0] as {
          form_key: string;
          title: string;
          questions: unknown;
          updated_at: string;
        };
        let questions = f.questions;
        if (typeof questions === "string") {
          try {
            questions = JSON.parse(questions);
          } catch {
            questions = DEFAULT_QUESTIONS;
          }
        }
        if (!Array.isArray(questions) || !questions.length) {
          questions = DEFAULT_QUESTIONS;
        }
        return json({
          form_key: f.form_key,
          title: f.title,
          questions,
          updated_at: f.updated_at,
          require_geo: true,
          require_photo: true,
          require_audio: true,
        });
      } catch (e) {
        return json({
          form_key: "default",
          title: "Field Survey",
          questions: DEFAULT_QUESTIONS,
          require_geo: true,
          require_photo: true,
          require_audio: true,
          warning: (e as Error).message,
        });
      }
    }

    // Admin saves question bank (dashboard)
    if (path === "/api/admin/questions" && method === "PUT") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      if (!hasPower(me, "can_edit_surveys")) {
        return json({
          error: "Super Admin has not granted your account survey-editing rights",
        }, 403);
      }
      const body = await readBody(req);
      const title = String(body.title || "Field Survey");
      const questions = Array.isArray(body.questions) ? body.questions : DEFAULT_QUESTIONS;
      await sql`
        INSERT INTO survey_form (form_key, title, questions, updated_at)
        VALUES ('default', ${title}, ${JSON.stringify(questions)}::jsonb, NOW())
        ON CONFLICT (form_key) DO UPDATE
        SET title = EXCLUDED.title,
            questions = EXCLUDED.questions,
            updated_at = NOW()
      `;
      return json({ ok: true, title, questions, count: questions.length });
    }

    // Surveyor's own records (field app "My records" screen)
    if (path === "/api/submissions/me" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const uId = String(me.id);
      const names = [me.name, me.username].filter(Boolean);
      const rows = await sql`
        SELECT id, payload, created_at FROM submissions
        WHERE payload->>'user_id' = ${uId}
           OR payload->>'submitted_by' = ANY(${names})
        ORDER BY created_at DESC LIMIT 500
      `.catch(() => []);
      const mediaRows = await sql`
        SELECT submission_id, kind, url, storage, meta FROM survey_media
      `.catch(() => []);
      const mediaMap = new Map<number, { url: string | null; kind: string }[]>();
      for (const m of mediaRows as {
        submission_id: number;
        kind: string;
        url: string | null;
        storage: string | null;
        meta: unknown;
      }[]) {
        const meta =
          typeof m.meta === "string"
            ? parsePayload(m.meta)
            : (m.meta as Record<string, unknown>) || {};
        const url = m.url || (meta.url as string) || null;
        const arr = mediaMap.get(Number(m.submission_id)) || [];
        arr.push({ url, kind: m.kind });
        mediaMap.set(Number(m.submission_id), arr);
      }
      const items = (rows as Record<string, unknown>[]).map((r) => {
        const payload = parsePayload(r.payload);
        const answers = (payload?.answers || payload) as Record<string, unknown>;
        const media = mediaMap.get(Number(r.id)) || [];
        return {
          id: r.id,
          created_at: r.created_at,
          status: payloadStatus(payload),
          submitted_by: String(
            payload?.submitted_by || answers?.data_collector || "",
          ),
          photo_url: media.find((m) => m.kind === "photo")?.url || null,
          audio_url: media.find((m) => m.kind === "audio")?.url || null,
          media,
        };
      });
      return json({ items, count: items.length });
    }

    if (path === "/api/submissions" && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin" && me.role !== "surveyor") {
        return json({ error: "Login required as admin or surveyor" }, 403);
      }
      const body = await readBody(req);
      // Q/A only — media uploaded separately to /api/submissions/:id/media
      const answers = (body.answers || body) as Record<string, unknown>;
      const geo = body.geo || null;
      const agent =
        String(body.submitted_by || "").trim() || me.name || me.username;
      // Require geo lock on every field submission
      if (!geo || typeof geo !== "object") {
        return json({
          error: "GPS lock required — lat/lng missing",
          code: "geo_lock_required",
        }, 422);
      }
      const gLat = Number((geo as Record<string, unknown>).lat ?? (geo as Record<string, unknown>).latitude);
      const gLng = Number((geo as Record<string, unknown>).lng ?? (geo as Record<string, unknown>).longitude);
      if (!Number.isFinite(gLat) || !Number.isFinite(gLng) || (gLat === 0 && gLng === 0)) {
        return json({
          error: "GPS lock invalid",
          code: "geo_lock_invalid",
        }, 422);
      }

      const payload = {
        form_key: body.form_key || "default",
        form_id: body.form_id || `field-${Date.now()}`,
        source: body.source || "mobile-field-survey",
        submitted_by: agent,
        user_id: me.id,
        user_role: me.role,
        status: "pending",
        geo: geo,
        location_details: body.location_details || null,
        locks: body.locks || { geo: true },
        has_photo: false,
        has_audio: false,
        answers: { ...answers, data_collector: agent },
        // Q/A separated from media blobs
        content_type: "qa",
        // Client app version (pushed from React build)
        app_version: body.app_version ? String(body.app_version) : null,
        app_build: body.app_build ? String(body.app_build) : null,
        app_version_code: body.app_version_code != null
          ? Number(body.app_version_code)
          : null,
      };
      // BR-004 write scope: records may only be written into projects the caller
      // belongs to. Client Admins → own/assigned projects (plus the always-visible
      // legacy/default forms); Surveyors → the surveys they are assigned to (or the
      // shared default form, which the field app uses when no assignment exists).
      if (me.role === "admin") {
        const writeScope = await adminFormKeyScope(sql, me);
        const fk = String(payload.form_key || "default");
        if (writeScope && !writeScope.includes(fk)) {
          return json({
            error: `You can only submit records to your own projects (${writeScope.length ? writeScope.join(", ") : "none"})`,
          }, 403);
        }
      } else if (me.role === "surveyor") {
        const fk = String(payload.form_key || "default");
        if (fk !== "default") {
          const asg = await sql`
            SELECT f.form_key FROM survey_assignments a
            JOIN survey_form f ON f.id = a.survey_id
            WHERE a.user_id = ${me.id} AND f.form_key = ${fk}
            LIMIT 1
          `.catch(() => []);
          if (!asg.length) {
            return json({
              error: "You are not assigned to this survey. Ask your Client Admin for the survey assignment.",
            }, 403);
          }
        }
      }
      // Idempotent: a field-app sync retry of the same package must not insert a duplicate
      const pkgId = String(
        (answers as Record<string, unknown>)?.client_package_id ||
          body.client_package_id ||
          "",
      ).trim();
      if (pkgId) {
        const existing = await sql`
          SELECT id FROM submissions
          WHERE payload->'answers'->>'client_package_id' = ${pkgId}
             OR payload->>'client_package_id' = ${pkgId}
          ORDER BY id LIMIT 1
        `.catch(() => []);
        if (existing.length) {
          return json({
            ok: true,
            duplicate: true,
            id: (existing[0] as { id: number }).id,
            note: "Already received — returning existing record",
          });
        }
      }
      const rows = await sql`
        INSERT INTO submissions (payload)
        VALUES (${JSON.stringify(payload)}::jsonb)
        RETURNING id, payload, created_at
      `;
      const row = rows[0];
      return json({
        ok: true,
        id: row.id,
        form_id: payload.form_id,
        source: payload.source,
        submitted_by: agent,
        status: "pending",
        answers: payload.answers,
        geo,
        created_at: row.created_at,
        next: "POST /api/submissions/:id/media with kind=photo|audio",
        note: "Q/A saved. Upload photo and audio separately.",
      }, 201);
    }

    // Separate media upload — DEFAULT Neon (no card). Optional R2/custom if env set.
    if (path.match(/^\/api\/submissions\/\d+\/media$/) && method === "POST") {
      if (!me) return json({ error: "Login required" }, 401);
      if (me.role !== "admin" && me.role !== "surveyor") {
        return json({ error: "Forbidden" }, 403);
      }
      const id = Number(path.split("/")[3]);
      const body = await readBody(req);
      const kind = String(body.kind || "").toLowerCase(); // photo | audio
      if (kind !== "photo" && kind !== "audio") {
        return json({ error: "kind must be photo or audio" }, 400);
      }

      const scopeKeys = await adminFormKeyScope(sql, me);
      const exists = scopeKeys
        ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
        : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
      if (!exists.length) return json({ error: "Submission not found" }, 404);

      let mime = String(
        body.mime || (kind === "photo" ? "image/jpeg" : "audio/webm"),
      );
      let publicUrl = body.url ? String(body.url).trim() : "";
      let provider = body.storage ? String(body.storage) : "";
      let dataB64 = "";
      let byteLen = 0;
      let mode: "external" | "neon" | "client_url" = "neon";

      if (publicUrl && /^https?:\/\//i.test(publicUrl)) {
        provider = provider || "client_url";
        mode = "client_url";
      } else {
        let data = String(body.data || "");
        const mimeMatch = data.match(/^data:([^;]+);base64,/);
        if (mimeMatch) {
          mime = String(body.mime || mimeMatch[1] || mime);
          data = data.slice(mimeMatch[0].length);
        }
        // Incoming cap (~1.2MB base64)
        if (data.length > 1_200_000) {
          return json({
            error: "Media too large. Compress photo or shorten audio (max ~700KB).",
          }, 413);
        }
        if (!data) {
          return json({ error: "data (base64) required" }, 400);
        }
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          bytes = b64ToBytes(data);
        } catch {
          return json({ error: "Invalid base64 media data" }, 400);
        }
        byteLen = bytes.length;
        if (byteLen < 50) {
          return json({ error: "Media file too small / empty" }, 400);
        }
        if (kind === "photo" && !isImageBytes(bytes)) {
          return json({ error: "Not a valid image file (JPEG/PNG/GIF/WebP)" }, 400);
        }
        try {
          const stored = await storeMediaLinked(bytes, mime, kind);
          provider = stored.provider;
          mode = stored.mode;
          publicUrl = stored.url || "";
          dataB64 = stored.dataB64 || "";
        } catch (e) {
          return json({
            error: (e as Error).message || "Media store failed",
            hint: "No credit card needed — media is stored free in Neon (size-limited).",
          }, 413);
        }
      }

      const meta = {
        ...(body.meta && typeof body.meta === "object" ? body.meta : {}),
        storage: provider,
        bytes: byteLen || null,
        mode,
        no_card: true,
      };

      const mediaRows = await sql`
        INSERT INTO survey_media (submission_id, kind, mime, data, url, storage, meta)
        VALUES (
          ${id},
          ${kind},
          ${mime},
          ${dataB64},
          ${publicUrl || null},
          ${provider},
          ${JSON.stringify(meta)}::jsonb
        )
        RETURNING id, kind, mime, url, storage, created_at
      `.catch(async () =>
        await sql`
          INSERT INTO survey_media (submission_id, kind, mime, data, meta)
          VALUES (
            ${id},
            ${kind},
            ${mime},
            ${dataB64 || (publicUrl ? `url:${publicUrl}` : "")},
            ${JSON.stringify(meta)}::jsonb
          )
          RETURNING id, kind, mime, created_at
        `
      );

      const mediaId = Number((mediaRows[0] as { id: number }).id);
      // Neon-hosted files are served by API (auth) — no external card service
      if (mode === "neon" && !publicUrl) {
        publicUrl = `/api/media/${mediaId}/file`;
        await sql`
          UPDATE survey_media SET url = ${publicUrl} WHERE id = ${mediaId}
        `.catch(() => null);
      }

      let payload = parsePayload(exists[0].payload);
      if (kind === "photo") {
        payload.has_photo = true;
        payload.photo_url = publicUrl;
        payload.photo_media_id = mediaId;
      }
      if (kind === "audio") {
        payload.has_audio = true;
        payload.audio_url = publicUrl;
        payload.audio_media_id = mediaId;
      }
      payload.media_storage = provider;
      payload.media_updated_at = new Date().toISOString();
      await sql`
        UPDATE submissions SET payload = ${JSON.stringify(payload)}::jsonb WHERE id = ${id}
      `;

      return json({
        ok: true,
        submission_id: id,
        media: {
          id: mediaId,
          kind,
          mime,
          url: publicUrl,
          storage: provider,
          mode,
        },
        free_storage: true,
        no_card: true,
        linked: true,
        url: publicUrl,
        storage: provider,
        note:
          mode === "neon"
            ? `${kind} linked free in Neon (no credit card). Admin opens via API.`
            : `${kind} linked on ${provider}.`,
      }, 201);
    }

    // Stream & download media file (Neon storage) — audio, video, photo
    if (path.match(/^\/api\/media\/\d+\/file$/) && method === "GET") {
      const mediaId = Number(path.split("/")[3]);
      const rows = await sql`
        SELECT id, kind, mime, data, url, storage, submission_id
        FROM survey_media WHERE id = ${mediaId} LIMIT 1
      `.catch(async () =>
        await sql`
          SELECT id, kind, mime, data, submission_id
          FROM survey_media WHERE id = ${mediaId} LIMIT 1
        `
      );
      if (!rows.length) return json({ error: "Not found" }, 404);
      const row = rows[0] as {
        id: number;
        kind: string;
        mime: string;
        data: string;
        url?: string;
        storage?: string;
      };
      // Redirect external URLs
      if (row.url && /^https?:\/\//i.test(String(row.url))) {
        return new Response(null, {
          status: 302,
          headers: { Location: String(row.url), ...corsHeaders(req) },
        });
      }
      const raw = String(row.data || "");
      if (!raw || raw.startsWith("url:")) {
        if (raw.startsWith("url:")) {
          return new Response(null, {
            status: 302,
            headers: { Location: raw.slice(4), ...corsHeaders(req) },
          });
        }
        return json({ error: "No media data" }, 404);
      }
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = b64ToBytes(raw);
      } catch {
        return json({ error: "Corrupt media data" }, 500);
      }

      const isDownload = url.searchParams.get("download") === "1";
      const mime = row.mime || (row.kind === "audio" ? "audio/webm" : row.kind === "video" ? "video/mp4" : "image/jpeg");
      const ext = mime.includes("audio")
        ? "mp3"
        : mime.includes("video")
        ? "mp4"
        : mime.includes("png")
        ? "png"
        : mime.includes("jpeg") || mime.includes("jpg")
        ? "jpg"
        : "bin";

      const filename = `${row.kind || "media"}-${row.id}.${ext}`;
      const disp = isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`;

      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": mime,
          "accept-ranges": "bytes",
          "content-length": String(bytes.length),
          "cache-control": "public, max-age=86400",
          "content-disposition": disp,
          ...corsHeaders(req),
        },
      });
    }

    // List media for a submission — returns free links (Neon API or external URL)
    if (path.match(/^\/api\/submissions\/\d+\/media$/) && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const id = Number(path.split("/")[3]);
      if (isPortalAdmin(me.role)) {
        // Client Admins see media only for records in their own/assigned projects.
        const scopeKeys = await adminFormKeyScope(sql, me);
        if (scopeKeys) {
          const visible = await sql`
            SELECT id FROM submissions
            WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys}) LIMIT 1
          `.catch(() => []);
          if (!visible.length) return json({ error: "Not found" }, 404);
        }
      } else {
        // Surveyor can view media only for their own submission
        const own = await sql`
          SELECT id FROM submissions WHERE id = ${id}
            AND (payload->>'user_id' = ${String(me.id)}
                 OR payload->>'submitted_by' = ANY(${[me.name, me.username].filter(Boolean)}))
          LIMIT 1
        `.catch(() => []);
        if (!own.length) return json({ error: "Admin only" }, 403);
      }
      const rows = await sql`
        SELECT id, kind, mime, url, storage, meta, created_at,
               CASE WHEN data IS NULL OR data = '' THEN 0 ELSE length(data) END AS neon_bytes
        FROM survey_media WHERE submission_id = ${id} ORDER BY id
      `.catch(async () =>
        await sql`
          SELECT id, kind, mime, meta, created_at, data,
                 length(data) AS neon_bytes
          FROM survey_media WHERE submission_id = ${id} ORDER BY id
        `
      );
      const media = (rows as Record<string, unknown>[]).map((r) => {
        const meta =
          typeof r.meta === "string"
            ? parsePayload(r.meta)
            : (r.meta as Record<string, unknown>) || {};
        let url = (r.url as string) || (meta.url as string) || null;
        if (!url && r.id) url = `/api/media/${r.id}/file`;
        if (!url && typeof r.data === "string" && String(r.data).startsWith("url:")) {
          url = String(r.data).slice(4);
        }
        return {
          id: r.id,
          kind: r.kind,
          mime: r.mime,
          url,
          storage: r.storage || meta.storage || "neon",
          neon_bytes: r.neon_bytes || 0,
          no_card: true,
          meta,
          created_at: r.created_at,
        };
      });
      return json({
        submission_id: id,
        media,
        free_storage: true,
        no_card: true,
        note: "Default storage is free Neon (no credit card). Paths /api/media/:id/file need admin login.",
      });
    }

    // Minimal geo for cascading dropdowns
    if (path === "/api/geo" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      try {
        const acs = await sql`
          SELECT name AS constituency, covering_districts AS district,
                 mp_constituency AS "mpConstituency"
          FROM assembly_constituencies ORDER BY name
        `;
        const districtsRows = await sql`SELECT name FROM districts ORDER BY name`;
        const districtSet = new Set(districtsRows.map((d) => d.name));
        const constituencies = acs.map((r: Record<string, string>) => {
          const covering = String(r.district || "").split(",").map((s) => s.trim()).filter(Boolean);
          covering.forEach((d) => districtSet.add(d));
          return {
            constituency: r.constituency,
            district: covering[0] || "",
            coveringDistricts: covering,
            mpConstituency: String(r.mpConstituency || "").replace(/\s*\(.*?\)\s*$/, ""),
          };
        });
        return json({
          constituencies,
          districts: [...districtSet].sort(),
          mpConstituencies: [],
        });
      } catch {
        return json({ constituencies: [], districts: [], mpConstituencies: [] });
      }
    }

    if (path === "/api/geo/mandals" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const district = url.searchParams.get("district") || "";
      try {
        const rows = district
          ? await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals WHERE district = ${district} ORDER BY mandal_name
            `
          : await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals ORDER BY district, mandal_name LIMIT 500
            `;
        return json({ mandals: rows });
      } catch {
        return json({ mandals: [] });
      }
    }

    if (path === "/api/geo/revenue_divisions" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      try {
        const rows = await sql`SELECT name, district FROM revenue_divisions ORDER BY name LIMIT 200`;
        return json({ revenueDivisions: rows });
      } catch {
        return json({ revenueDivisions: [] });
      }
    }

    // Dashboard + filters — full super-set / sub-set analytics
    if (path === "/api/analytics" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      const envScope = await adminFormKeyScope(sql, me);
      const result = await buildAnalytics(sql, url, envScope);
      // Envelope: data_as_of watermark + fact health (09-ANALYTICS-SPEC §5/§8, ADR-014/016)
      const [w] = envScope
        ? await sql`
            SELECT MAX(confirmed_at) AS as_of FROM record_facts WHERE survey_key = ANY(${envScope})
          `.catch(() => [{ as_of: null }])
        : await sql`
            SELECT MAX(confirmed_at) AS as_of FROM record_facts
          `.catch(() => [{ as_of: null }]);
      let dataAsOf: string | null = (w as { as_of?: unknown } | undefined)?.as_of
        ? String((w as { as_of?: unknown }).as_of)
        : null;
      if (!dataAsOf) {
        // transient window before backfill — fall back to freshest confirmed stamp
        const [f] = envScope
          ? await sql`
              SELECT MAX((payload->>'confirmed_at')::timestamptz) AS as_of
              FROM submissions
              WHERE payload->>'status' = 'confirmed' AND payload->>'form_key' = ANY(${envScope})
            `.catch(() => [{ as_of: null }])
          : await sql`
              SELECT MAX((payload->>'confirmed_at')::timestamptz) AS as_of
              FROM submissions WHERE payload->>'status' = 'confirmed'
            `.catch(() => [{ as_of: null }]);
        dataAsOf = (f as { as_of?: unknown } | undefined)?.as_of
          ? String((f as { as_of?: unknown }).as_of)
          : null;
      }
      const [fc] = envScope
        ? await sql`SELECT COUNT(*)::int AS n FROM record_facts WHERE survey_key = ANY(${envScope})`.catch(() => [{ n: 0 }])
        : await sql`SELECT COUNT(*)::int AS n FROM record_facts`.catch(() => [{ n: 0 }]);
      const [failedN] = envScope
        ? await sql`
            SELECT COUNT(*)::int AS n FROM submissions
            WHERE fact_status = 'failed' AND payload->>'form_key' = ANY(${envScope})
          `.catch(() => [{ n: 0 }])
        : await sql`
            SELECT COUNT(*)::int AS n FROM submissions WHERE fact_status = 'failed'
          `.catch(() => [{ n: 0 }]);
      const failed = Number((failedN as { n?: number } | undefined)?.n ?? 0);
      const confirmedTotal = Number(result?.statusCounts?.confirmed ?? 0);
      return json({
        ...result,
        data_as_of: dataAsOf,
        empty: confirmedTotal === 0,
        degraded: failed > 0,
        degraded_reason: failed > 0
          ? `${failed} confirmed record${failed === 1 ? "" : "s"} with failed fact materialization — retry in Review`
          : null,
        facts: {
          materialized: Number((fc as { n?: number } | undefined)?.n ?? 0),
          failed,
        },
      });
    }

    // Admin geo summary (for Upload tab)
    if (path === "/api/admin/geo-summary" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      try {
        const [d] = await sql`SELECT COUNT(*)::int AS n FROM districts`;
        const [m] = await sql`SELECT COUNT(*)::int AS n FROM mandals`;
        const [a] = await sql`SELECT COUNT(*)::int AS n FROM assembly_constituencies`;
        const [p] = await sql`SELECT COUNT(*)::int AS n FROM mp_constituencies`;
        const [r] = await sql`SELECT COUNT(*)::int AS n FROM revenue_divisions`;
        const geoScope = await adminFormKeyScope(sql, me);
        const [s] = geoScope
          ? await sql`SELECT COUNT(*)::int AS n FROM submissions WHERE payload->>'form_key' = ANY(${geoScope})`
          : await sql`SELECT COUNT(*)::int AS n FROM submissions`;
        const districts = await sql`SELECT * FROM districts ORDER BY name LIMIT 100`;
        const acs = await sql`
          SELECT name, covering_districts, mp_constituency, reservation
          FROM assembly_constituencies ORDER BY name LIMIT 150
        `;
        const mps = await sql`SELECT * FROM mp_constituencies ORDER BY name LIMIT 50`;
        return json({
          counts: {
            districts: d?.n ?? 0,
            mandals: m?.n ?? 0,
            assembly_constituencies: a?.n ?? 0,
            mp_constituencies: p?.n ?? 0,
            revenue_divisions: r?.n ?? 0,
            submissions: s?.n ?? 0,
          },
          districts,
          assembly_constituencies: acs,
          mp_constituencies: mps,
        });
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    }

    // Admin data export: text/CSV of submissions with photo + audio links.
    // Filters: period (total | today | day | month), day, month, user (surveyor),
    // survey (form_key), district, constituency, status (default confirmed).
    if (path === "/api/admin/export" && method === "GET") {
      if (!me) return json({ error: "Login required" }, 401);
      if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
      try {
        let dateFrom = (url.searchParams.get("date_from") || url.searchParams.get("from") || "").trim();
        let dateTo = (url.searchParams.get("date_to") || url.searchParams.get("to") || "").trim();
        const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
        const dayParam = (url.searchParams.get("day") || "").trim();
        const monthParam = (url.searchParams.get("month") || "").trim();
        if (period === "today") {
          const t = new Date().toISOString().slice(0, 10);
          dateFrom = t;
          dateTo = t;
        } else if (period === "day" && dayParam) {
          dateFrom = dayParam;
          dateTo = dayParam;
        } else if (period === "month" && monthParam) {
          const [y, m] = monthParam.split("-").map(Number);
          if (y && m) {
            const last = new Date(y, m, 0).getDate();
            dateFrom = `${monthParam}-01`;
            dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
          }
        }
        const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
        const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
        const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
        const constituencyQ = (url.searchParams.get("constituency") || "").trim().toLowerCase();
        const statusQ = (url.searchParams.get("status") || "confirmed").trim().toLowerCase();

        const allRows = await loadAnalyticsRows(sql, 20000, await adminFormKeyScope(sql, me));
        let rows = allRows;
        if (statusQ !== "all") rows = rows.filter((r) => r.status === statusQ);
        if (dateFrom) rows = rows.filter((r) => dayKey(r.created_at) >= dateFrom);
        if (dateTo) rows = rows.filter((r) => dayKey(r.created_at) <= dateTo);
        if (userQ) {
          rows = rows.filter((r) =>
            String(r.submitted_by || "").toLowerCase().includes(userQ)
          );
        }
        if (surveyQ) rows = rows.filter((r) => r.formKey === surveyQ);
        if (districtQ) {
          rows = rows.filter((r) => String(r.district || "").toLowerCase() === districtQ);
        }
        if (constituencyQ) {
          rows = rows.filter((r) => String(r.constituency || "").toLowerCase() === constituencyQ);
        }

        // Photo / audio links per submission (first of each kind)
        const mediaRows = await sql`
          SELECT submission_id, kind, url FROM survey_media
        `.catch(() => []);
        const photoUrl = new Map<number, string>();
        const audioUrl = new Map<number, string>();
        for (const m of mediaRows as { submission_id: number; kind: string; url: string | null }[]) {
          const id = Number(m.submission_id);
          const u = m.url || "";
          if (m.kind === "photo" && !photoUrl.has(id)) photoUrl.set(id, u);
          if (m.kind === "audio" && !audioUrl.has(id)) audioUrl.set(id, u);
        }

        // Columns: fixed fields + union of all answer keys
        const fixed = [
          "id", "date", "survey", "surveyor", "district", "constituency", "mandal",
          "latitude", "longitude", "party", "gender", "caste", "age", "respondent",
          "photo_url", "audio_url",
        ];
        const qKeys = new Set<string>();
        for (const r of rows) {
          for (const k of Object.keys(r.answers || {})) qKeys.add(k);
        }
        const qCols = [...qKeys].sort();
        const esc = (v: unknown) => {
          const s = String(v ?? "");
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines: string[] = [];
        lines.push([...fixed, ...qCols].map(esc).join(","));
        for (const r of rows) {
          const rObj = r as unknown as Record<string, unknown>;
          const base: Record<string, unknown> = {
            id: r.id,
            date: dayKey(r.created_at),
            survey: r.formKey,
            surveyor: r.submitted_by,
            district: r.district,
            constituency: r.constituency,
            mandal: rObj.mandal || "",
            latitude: rObj.lat || "",
            longitude: rObj.lng || "",
            party: r.party,
            gender: r.gender,
            caste: r.caste,
            age: r.age,
            respondent: r.respondent,
            photo_url: photoUrl.get(Number(r.id)) || "",
            audio_url: audioUrl.get(Number(r.id)) || "",
          };
          const rec: string[] = [];
          for (const c of fixed) rec.push(esc(base[c]));
          for (const c of qCols) {
            const v = (r.answers || {})[c];
            rec.push(esc(Array.isArray(v) ? v.join(" | ") : v));
          }
          lines.push(rec.join(","));
        }
        logAudit(me, "data_export", "export", null, {
          rows: rows.length,
          status: statusQ,
          from: dateFrom,
          to: dateTo,
        });
        return new Response(lines.join("\n"), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="survey-export-${dayParam || monthParam || "total"}.csv"`,
            ...corsHeaders(req),
          },
        });
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    }

    return json({ error: `Not found: ${method} ${path}` }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});
