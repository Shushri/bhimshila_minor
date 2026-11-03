/**
 * Official response protocol and relief-entitlement lookup.
 *
 * Every answer carries its source. In this domain an uncited protocol answer is
 * worse than no answer — a coordinator acting on an invented relief figure
 * causes a real problem for a real family, so nothing here is generated.
 *
 * Retrieval is keyword scoring over a curated corpus rather than embeddings:
 * the corpus is small, the terms are specific ("SDRF", "gratuitous relief",
 * "orange alert"), and a lookup that never hallucinates matters more here than
 * one that handles paraphrase well.
 */

export interface Protocol {
  id: string;
  topic: string;
  title: string;
  body: string;
  source: string;
  reference: string;
  /**
   * Who the answer is for.
   *
   * The original set was all `coordinator` — relief entitlements and official
   * SOPs — which answers "what is a family owed" but not "paani aa raha hai,
   * main abhi kya karun". Both matter, and they are different answers to the
   * same hazard, so the audience is explicit rather than inferred.
   */
  audience: "citizen" | "coordinator";
  /** Where in the event this applies. Absent for entitlements and definitions. */
  phase?: "before" | "during" | "after";
  /** Hazard family, matching hazardKind() in kb/sachet.ts. */
  hazard?: string;
}

/**
 * Figures are NDMA/SDRF norms as published for the 2022–26 finance cycle.
 * They are indicative and must be checked against the current SDRF circular
 * before anything is disbursed — the code says so, and so does the answer.
 */
export const PROTOCOLS: Protocol[] = [
  {
    id: "sdrf-death",
    topic:
      "relief compensation death ex-gratia family " +
      "muavza muaawza maut mrityu parivar aarthik sahayata guzara mrit",
    title: "Ex-gratia for loss of life",
    body:
      "₹4,00,000 per deceased person to the next of kin, from the State Disaster Response Fund. " +
      "Payable for deaths caused by a notified disaster. Requires a death certificate and district " +
      "administration verification.",
    source: "NDMA / SDRF norms of assistance",
    reference: "SDRF item 1(a)",
    audience: "coordinator",
  },
  {
    id: "sdrf-injury",
    topic:
      "relief compensation injury disabled hospital " +
      "muavza chot ghayal zakhmi apahij viklang aspatal bharti",
    title: "Assistance for injury",
    body:
      "₹2,50,000 for disability of 60% or more. ₹74,000 for disability between 40% and 60%. " +
      "₹16,000 for a person hospitalised more than a week; ₹5,400 if hospitalised less than a week.",
    source: "NDMA / SDRF norms of assistance",
    reference: "SDRF item 1(b)–(c)",
    audience: "coordinator",
  },
  {
    id: "sdrf-house",
    topic:
      "relief house damage destroyed kutcha pucca hut shelter " +
      "muavza muaawza ghar makan jhopdi tuta toot gira dhah nuksan kshati basti",
    title: "Assistance for damaged houses",
    body:
      "Fully destroyed pucca or kutcha house: ₹1,20,000 in plain areas, ₹1,30,000 in hilly areas. " +
      "Severely damaged house: ₹6,500. Partially damaged: ₹4,000. Destroyed hut: ₹8,000.",
    source: "NDMA / SDRF norms of assistance",
    reference: "SDRF item 4",
    audience: "coordinator",
  },
  {
    id: "sdrf-relief-camp",
    topic:
      "relief camp food gratuitous cash dole shelter days " +
      "shivir rahat khana bhojan paisa roz prati din adami bacha",
    title: "Gratuitous relief and camp support",
    body:
      "Gratuitous relief for families whose livelihood is seriously affected: ₹60 per adult and " +
      "₹45 per child per day, for up to 30 days. Camp costs — food, water, sanitation, lighting — " +
      "are met from SDRF for the period the camp operates.",
    source: "NDMA / SDRF norms of assistance",
    reference: "SDRF item 2",
    audience: "coordinator",
  },
  {
    id: "imd-colour",
    topic:
      "alert colour color code red orange yellow green warning meaning " +
      "chetavni rang lal peela hara matlab arth",
    title: "What IMD alert colours mean",
    body:
      "Green — no action needed. Yellow — be updated, watch the situation. " +
      "Orange — be prepared, keep response teams on standby and avoid non-essential travel. " +
      "Red — take action, evacuate vulnerable areas and suspend movement in the affected zone.",
    source: "India Meteorological Department",
    reference: "IMD colour-code warning system",
    audience: "coordinator",
  },
  {
    id: "flood-sop",
    topic:
      "flood protocol sop response flash flood procedure steps " +
      "baadh badh paani protocol prakriya kadam nadi",
    title: "Flood response — standing procedure",
    body:
      "On an orange or red warning: pre-position boats and rescue teams before the rain peaks, not " +
      "after. Identify and evacuate low-lying settlements, riverbanks and temporary shelters first. " +
      "Open relief camps on high ground with a marked route. Do not attempt boat rescue in an " +
      "active current at night unless life is in immediate danger. Restore drinking water and " +
      "chlorinate sources before people return.",
    source: "NDMA National Disaster Management Guidelines — Floods",
    reference: "NDMA flood guidelines, response phase",
    audience: "coordinator",
  },
  {
    id: "landslide-sop",
    topic:
      "landslide protocol hills slope cracks evacuation procedure " +
      "bhuskhalan pahad dhalan darar nikasi pahaad malba",
    title: "Landslide response — standing procedure",
    body:
      "Treat fresh cracks, tilting trees, sudden spring flow or muddy stream water as immediate " +
      "evacuation signals. Move people across the slope, never downhill. Close the road above and " +
      "below the slide before clearing. Assume a second slide follows the first during continuous " +
      "rain, and do not restore traffic until the slope is assessed.",
    source: "NDMA National Disaster Management Guidelines — Landslides",
    reference: "NDMA landslide guidelines, response phase",
    audience: "coordinator",
  },
  {
    id: "cloudburst-sop",
    topic:
      "cloudburst himalaya flash flood nala stream sudden rain " +
      "badal fatna baadal phatna nala nadi achanak barish himalay",
    title: "Cloudburst and flash flood — standing procedure",
    body:
      "A cloudburst gives minutes, not hours. Anyone camped in or beside a nala or dry stream bed " +
      "is the first priority, including labour camps and temporary sheds that appear on no register. " +
      "Move uphill and away from the channel — not along it. Rainfall gauges will under-report a " +
      "cloudburst because it is smaller than the measuring grid, so act on the ground observation.",
    source: "NDMA guidelines — hydro-meteorological hazards",
    reference: "NDMA cloudburst advisory",
    audience: "coordinator",
  },
  {
    id: "heat-sop",
    topic:
      "heatwave heat action plan outdoor workers protocol " +
      "loo lu garmi tapish mazdoor shramik dhoop",
    title: "Heatwave — standing procedure",
    body:
      "Shift outdoor work away from 12pm–4pm. Open cooling centres and ensure drinking water at " +
      "worksites and transport hubs. Prioritise outdoor workers, the elderly, infants, pregnant " +
      "women and people in informal settlements. Treat heatstroke as a medical emergency: move to " +
      "shade, cool the body actively, and transport immediately.",
    source: "NDMA National Guidelines — Heat Wave",
    reference: "NDMA heat action plan framework",
    audience: "coordinator",
  },
  {
    id: "camp-standards",
    topic:
      "relief camp standards space water toilet sphere minimum " +
      "shivir maanak jagah paani sauchalay nyoontam suvidha",
    title: "Relief camp minimum standards",
    body:
      "At least 3.5 sq m of covered living space per person. 15 litres of drinking water per person " +
      "per day. One toilet per 20 people, separated by gender and lit at night. Separate the " +
      "medical area from the kitchen, and register every arrival — including children travelling " +
      "alone.",
    source: "Sphere Handbook / NDMA camp management",
    reference: "Sphere minimum standards, shelter and WASH",
    audience: "coordinator",
  },

  // ─────────────────────────────────────────────────────── citizen guidance
  //
  // What the set above could not answer: "paani aa raha hai, main abhi kya
  // karun". Entitlements and SOPs tell a coordinator what a family is owed and
  // what an official does. Nobody had written down what the family does.
  //
  // The hazards here are chosen from what NDMA Sachet actually issues rather
  // than from a generic list. Lightning and thunderstorm together were 28 of
  // 102 alerts in a sampled sweep — the largest category after flood — and had
  // no entry at all.

  {
    id: "lightning-during",
    topic:
      "lightning thunderstorm strike shelter safe outside tree during now " +
      "bijli bijlee kadakna gaj vajrapat aakash bijli girna ped khet bahar surakshit abhi",
    title: "Lightning — what to do right now",
    body:
      "Go inside a building or a hard-topped vehicle immediately. If you are outdoors with no " +
      "shelter, crouch low on the balls of your feet with your feet together and your head down — " +
      "do not lie flat, and do not shelter under a tree, which is where most lightning deaths " +
      "happen. Get out of and away from water. Put down metal tools and umbrellas. If your hair " +
      "stands on end, a strike is imminent — crouch at once. Stay sheltered for 30 minutes after " +
      "the last thunder; strikes travel ahead of the rain.",
    source: "NDMA Do's and Don'ts — Lightning",
    reference: "NDMA lightning safety advisory",
    audience: "citizen",
    phase: "during",
    hazard: "storm",
  },
  {
    id: "lightning-before",
    topic:
      "lightning thunderstorm warning prepare farmers field work before " +
      "bijli chetavni taiyari kisan khet kaam pehle",
    title: "Lightning warning — before it arrives",
    body:
      "Most lightning deaths in India are people working in open fields. If a thunderstorm warning " +
      "is out, finish field work early and plan where you will shelter before you need it — a " +
      "building with wiring and plumbing, or a closed vehicle. Bring livestock in; do not tie them " +
      "under a lone tree. Unplug appliances. Charge phones while power is on.",
    source: "NDMA Do's and Don'ts — Lightning",
    reference: "NDMA lightning safety advisory",
    audience: "citizen",
    phase: "before",
    hazard: "storm",
  },
  {
    id: "lightning-first-aid",
    topic:
      "lightning struck person first aid cpr revive safe touch " +
      "bijli gir gayi aadmi prathmik upchar cpr bachana chhuna",
    title: "Someone has been struck by lightning",
    body:
      "A person struck by lightning carries no charge — it is safe to touch them immediately, and " +
      "the belief otherwise costs lives. Call for medical help. If they are not breathing, start " +
      "CPR at once; cardiac arrest is the usual cause of death and many are revived. Check for " +
      "burns where the current entered and left. Move the casualty only if the area is still exposed.",
    source: "NDMA Do's and Don'ts — Lightning",
    reference: "NDMA lightning safety advisory",
    audience: "citizen",
    phase: "during",
    hazard: "storm",
  },
  {
    id: "flood-during-citizen",
    topic:
      "flood water rising house what do now escape wade drive " +
      "baadh paani bhar raha ghar kya karun bachna nikalna chalna gaadi",
    title: "Flood water is rising — what to do now",
    body:
      "Move to the highest floor or higher ground and take drinking water, medicines and identity " +
      "documents. Switch off electricity at the mains before water reaches the sockets. Never walk " +
      "into moving water — knee-deep flow will take an adult off their feet — and never drive into " +
      "it, which is how most flood deaths happen. If water is rising and you cannot leave, get onto " +
      "the roof, not into a closed attic. Take a torch and something that makes noise so rescuers " +
      "can find you.",
    source: "NDMA Do's and Don'ts — Floods",
    reference: "NDMA flood safety advisory",
    audience: "citizen",
    phase: "during",
    hazard: "flood",
  },
  {
    id: "flood-before-citizen",
    topic:
      "flood warning prepare kit documents livestock before evacuate " +
      "baadh chetavni taiyari saman kagaz janwar pehle nikalna",
    title: "Flood warning — before the water arrives",
    body:
      "Keep identity and land documents in a waterproof bag you can carry in one hand. Charge " +
      "phones and power banks while electricity is on. Move livestock, grain and pumps to high " +
      "ground now, not later — moving them during the flood is what puts people in the water. " +
      "Agree a meeting point with your family in case you are separated. Know the route to the " +
      "nearest high ground on foot, because roads flood first.",
    source: "NDMA Do's and Don'ts — Floods",
    reference: "NDMA flood safety advisory",
    audience: "citizen",
    phase: "before",
    hazard: "flood",
  },
  {
    id: "flood-after-citizen",
    topic:
      "flood after water receded return home safe drink boil disease snake " +
      "baadh ke baad paani utar gaya ghar wapas surakshit peena ubalna bimari saap",
    title: "After the flood water goes down",
    body:
      "Do not return until the administration says the building is safe — flood water undermines " +
      "foundations that look intact. Boil or chlorinate all drinking water; cholera and typhoid " +
      "follow floods more reliably than the flood itself. Throw away food that touched flood water, " +
      "including sealed packets. Do not switch on electricity until wiring has been checked. Watch " +
      "for snakes in debris and inside houses. Photograph damage before clearing it — the claim " +
      "needs evidence.",
    source: "NDMA Do's and Don'ts — Floods",
    reference: "NDMA flood safety advisory",
    audience: "citizen",
    phase: "after",
    hazard: "flood",
  },
  {
    id: "heavy-rain-citizen",
    topic:
      "heavy rain warning very extremely what means do travel road river " +
      "bhari barish tez baarish chetavni matlab kya karna safar sadak nadi",
    title: "Heavy rain warning — what it means for you",
    body:
      "Heavy rain warnings are the most common alert issued in India, and the danger is rarely the " +
      "rain itself. Postpone travel, especially at night and on hill roads — a road that was fine " +
      "an hour ago can be gone. Stay away from rivers, nalas and drains, which rise long before " +
      "the water reaches your street. Do not park under trees or beside old walls. If you live in " +
      "a low-lying area, move valuables and documents up now rather than after the water arrives, " +
      "and keep a torch and charged phone within reach.",
    source: "NDMA Do's and Don'ts — Heavy rainfall",
    reference: "IMD heavy rainfall warning advisory",
    audience: "citizen",
    phase: "during",
    hazard: "rain",
  },
  {
    id: "cyclone-before",
    topic:
      "cyclone warning prepare coastal fishermen boat house before landfall " +
      "chakravat toofan chetavni taiyari samundar machhuara nav ghar pehle",
    title: "Cyclone warning — before landfall",
    body:
      "Fishermen: return to harbour and do not go out again until the all-clear. Secure the boat " +
      "above the high-water line. Strengthen the roof, and bring loose objects indoors — in a " +
      "cyclone anything unsecured becomes a projectile. Keep a battery radio; mobile networks fail " +
      "early. Store drinking water in every container you have. Know your cyclone shelter and go " +
      "before the wind builds, not during.",
    source: "NDMA Do's and Don'ts — Cyclones",
    reference: "NDMA cyclone safety advisory",
    audience: "citizen",
    phase: "before",
    hazard: "cyclone",
  },
  {
    id: "cyclone-during",
    topic:
      "cyclone during eye calm wind stop safe go outside storm surge " +
      "chakravat toofan ke dauran hawa ruk gayi shant bahar jana lehar",
    title: "During a cyclone — and the trap of the eye",
    body:
      "Stay inside, away from windows, in the strongest room. If the wind suddenly stops and the " +
      "sky clears, that is the eye — the other half of the storm is coming, from the opposite " +
      "direction, within minutes. Do not go outside. The storm surge, not the wind, kills most " +
      "people: if you are in a low coastal area you must be inland or in a shelter before it " +
      "arrives, because there is no evacuating during it.",
    source: "NDMA Do's and Don'ts — Cyclones",
    reference: "NDMA cyclone safety advisory",
    audience: "citizen",
    phase: "during",
    hazard: "cyclone",
  },
  {
    id: "earthquake-during",
    topic:
      "earthquake shaking during drop cover hold building stairs lift outside " +
      "bhukamp bhukump jhatka hilna kya karun mez neeche seedhi lift bahar",
    title: "Earthquake — during the shaking",
    body:
      "Drop, cover and hold on. Get under a sturdy table and hold it; if there is none, crouch " +
      "against an interior wall and protect your head and neck. Stay where you are until the " +
      "shaking stops — most injuries happen to people moving during it. Do not use a lift or run " +
      "for stairs. If you are outdoors, move away from buildings, walls and power lines and stay " +
      "in the open. If you are in bed, stay there and cover your head with a pillow.",
    source: "NDMA Do's and Don'ts — Earthquakes",
    reference: "NDMA earthquake safety advisory",
    audience: "citizen",
    phase: "during",
    hazard: "quake",
  },
  {
    id: "earthquake-after",
    topic:
      "earthquake after aftershock trapped building gas smell rescue " +
      "bhukamp ke baad jhatka fansa imarat gas boo bachav",
    title: "After an earthquake",
    body:
      "Expect aftershocks and leave a damaged building as soon as the shaking stops, using stairs. " +
      "Do not light a match or a flame until you are sure there is no gas leak. If you are trapped, " +
      "do not shout continuously — you exhaust yourself and inhale dust. Tap on a pipe or wall at " +
      "intervals, and cover your mouth with cloth. If you are searching, listen in silence at " +
      "intervals rather than digging blind.",
    source: "NDMA Do's and Don'ts — Earthquakes",
    reference: "NDMA earthquake safety advisory",
    audience: "citizen",
    phase: "after",
    hazard: "quake",
  },
  {
    id: "landslide-citizen",
    topic:
      "landslide hill house crack signs run where safe rain slope " +
      "bhuskhalan pahad ghar darar nishani bhagna kidhar surakshit barish dhalan",
    title: "Landslide — the signs and where to run",
    body:
      "Warning signs: new cracks in walls or ground, doors that suddenly jam, tilting trees or " +
      "poles, a spring appearing where there was none, or stream water turning muddy. If you see " +
      "them during heavy rain, leave at once. Run across the slope, never downhill — you cannot " +
      "outrun debris going down. At night, listen: a rumbling or a stream suddenly going quiet " +
      "upstream means move. Do not shelter at the base of a steep slope during continuous rain.",
    source: "NDMA Do's and Don'ts — Landslides",
    reference: "NDMA landslide safety advisory",
    audience: "citizen",
    phase: "during",
    hazard: "landslide",
  },
  {
    id: "urban-flood-citizen",
    topic:
      "urban flooding city waterlogging street underpass basement drown car " +
      "shehri baadh sheher jalbharav sadak underpass tehkhana doobna gaadi",
    title: "Urban flooding — streets, underpasses and basements",
    body:
      "Never enter a flooded underpass or subway, in a vehicle or on foot — the depth at the " +
      "centre is far greater than at the entrance and this is where urban flood deaths cluster. " +
      "Avoid walking near open drains and manholes; the covers lift and the opening is invisible " +
      "under water. Leave a basement before water reaches the door, because the pressure will hold " +
      "it shut. Stay away from fallen or sagging power lines and any pole standing in water.",
    source: "NDMA Do's and Don'ts — Urban Flooding",
    reference: "NDMA urban flooding advisory",
    audience: "citizen",
    phase: "during",
    hazard: "flood",
  },
  {
    id: "heatwave-citizen",
    topic:
      "heatwave heat stroke symptoms water work outside citizen " +
      "loo lu garmi tapish lakshan paani kaam bahar dhoop chakkar",
    title: "Heatwave — protecting yourself",
    body:
      "Drink water before you feel thirsty, and keep drinking even if you are not working. Avoid " +
      "being outdoors between noon and 4pm. Wear loose light-coloured cotton and cover your head. " +
      "Heatstroke is an emergency, not exhaustion: hot dry skin with no sweating, confusion, or " +
      "collapse means move the person into shade, wet them, fan them, and get medical help " +
      "immediately. Never leave anyone, especially a child, in a parked vehicle.",
    source: "NDMA Do's and Don'ts — Heat Wave",
    reference: "NDMA heat wave advisory",
    audience: "citizen",
    phase: "during",
    hazard: "heat",
  },
  {
    id: "coldwave-citizen",
    topic:
      "cold wave winter frostbite hypothermia heater coal shelter homeless " +
      "sheetlahar thand sardi thithurna heater angithi koyla rain basera",
    title: "Cold wave — staying safe",
    body:
      "Wear several thin layers rather than one thick one, and keep the head and feet covered. " +
      "Never burn coal or charcoal in a closed room for warmth — carbon monoxide kills people in " +
      "their sleep every winter, and there is no warning. Check on elderly neighbours and anyone " +
      "sleeping outside; night shelters exist in most cities. Shivering that stops without the " +
      "person warming up is hypothermia worsening, not improving — get help.",
    source: "NDMA Do's and Don'ts — Cold Wave",
    reference: "NDMA cold wave advisory",
    audience: "citizen",
    phase: "during",
    hazard: "cold",
  },
  {
    id: "squall-citizen",
    topic:
      "squall high wind gale dust storm andhi hoarding tree shelter " +
      "tez hawa aandhi dhool toofan hoarding ped bachna",
    title: "Squall or high wind — where not to stand",
    body:
      "Get inside and away from windows. Outdoors, the danger is what the wind moves: hoardings, " +
      "tin sheets, scaffolding, trees and power lines. Do not shelter beside a wall, a billboard " +
      "or under a tree. Stop the vehicle away from trees and poles and stay in it. Fishermen and " +
      "anyone on open water should return immediately — a squall builds faster than a boat can run.",
    source: "NDMA Do's and Don'ts — Thunderstorms and squalls",
    reference: "IMD squall warning advisory",
    audience: "citizen",
    phase: "during",
    hazard: "wind",
  },
  {
    id: "evacuation-citizen",
    topic:
      "evacuation what to take bag kit leave house order documents " +
      "nikasi khali karna kya le jana thaila saman ghar chodna kagaz",
    title: "Told to evacuate — what to take",
    body:
      "Take identity and land documents, cash, medicines with prescriptions, drinking water, a " +
      "torch, a charged phone and power bank, and warm dry clothes. One bag per person that they " +
      "can carry themselves. Switch off electricity, gas and water at the mains, lock up, and tell " +
      "a neighbour where you are going. Leave early — an evacuation on foot in daylight is a " +
      "different thing from one at night in water.",
    source: "NDMA community preparedness guidance",
    reference: "NDMA evacuation advisory",
    audience: "citizen",
    phase: "before",
  },
  {
    id: "drinking-water-after",
    topic:
      "drinking water safe boil chlorine tablet contaminated after disaster diarrhoea " +
      "peene ka paani surakshit ubalna chlorine goli ganda baad dast haiza",
    title: "Making water safe to drink after a disaster",
    body:
      "Boil water at a rolling boil for one minute, or add chlorine as directed on the tablet and " +
      "wait 30 minutes before drinking. Cloudy water must be filtered through cloth first — " +
      "chlorine does not work properly in it. Do not assume a covered well or a hand pump is safe " +
      "after flooding; both are contaminated by surface water. Watery diarrhoea with dehydration " +
      "in a camp is an outbreak until proven otherwise and must be reported the same day.",
    source: "Sphere Handbook — WASH / NDMA post-flood advisory",
    reference: "Sphere WASH standards",
    audience: "citizen",
    phase: "after",
  },
  {
    id: "sos-how-to",
    topic:
      "how to ask help sos report trapped call who contact emergency number " +
      "madad kaise mange sos report fanse call kisko sampark aapatkal number",
    title: "How to call for help, and what to say",
    body:
      "The national emergency number is 112. NDRF's helpline is 011-24363260 and most states run " +
      "a disaster control room reachable on 1070, district control rooms on 1077. When you call or " +
      "send a message, say four things in this order: where you are, how many people, what is " +
      "wrong, and whether anyone is injured. A landmark beats an address. If the call will not " +
      "connect, send a text — messages get through on a congested network when calls do not.",
    source: "NDMA / MHA emergency contact directory",
    reference: "National Emergency Number 112, NDRF helpline",
    audience: "citizen",
  },
  {
    id: "vulnerable-priority",
    topic:
      "vulnerable elderly children disabled pregnant priority evacuation who first " +
      "kamzor budhe bachche viklang garbhvati prathmikta pehle kisko",
    title: "Who to move first",
    body:
      "In order: people who cannot move themselves, then those who cannot move quickly. Bedridden " +
      "and disabled people, then the very elderly, then pregnant women, infants and small children, " +
      "then anyone alone or unwell. Move families together — separating a household means someone " +
      "goes back for the others. Assign one named person per household who cannot self-evacuate, " +
      "rather than relying on a general announcement.",
    source: "NDMA guidelines on vulnerable groups in disasters",
    reference: "NDMA inclusive disaster response guidance",
    audience: "coordinator",
    phase: "during",
  },
  {
    id: "camp-disease",
    topic:
      "camp disease outbreak sanitation toilets hygiene cholera measles " +
      "shivir bimari failna safai shauchalay swachhta haiza khasra",
    title: "Preventing disease in a relief camp",
    body:
      "The three that matter: safe drinking water, separated toilets, and hand-washing at the food " +
      "point. One toilet per 20 people, at least 30 metres from any water source and downhill of " +
      "it. Screen for measles on arrival and vaccinate children aged 6 months to 15 years if " +
      "coverage is unknown — measles in a camp spreads faster than anything else. Report three or " +
      "more cases of watery diarrhoea from one camp the same day.",
    source: "Sphere Handbook — WASH and Health",
    reference: "Sphere minimum standards",
    audience: "coordinator",
    phase: "after",
  },
  {
    id: "search-rescue-priority",
    topic:
      "search rescue priority order who first collapsed building water golden hour " +
      "khoj bachav prathmikta kram kisko pehle imarat giri paani",
    title: "Search and rescue — order of work",
    body:
      "Work the survivable spaces first: voids under stairs, beside heavy furniture, and against " +
      "external walls. Silence the site periodically and listen — this finds more people than " +
      "equipment does. In water, the priority is people in the current, then people in rising " +
      "water, then people isolated but dry. Mark every structure searched with the time and result " +
      "so no team searches it twice while someone waits elsewhere.",
    source: "NDRF search and rescue standard operating procedure",
    reference: "NDRF collapsed structure search and rescue SOP",
    audience: "coordinator",
    phase: "during",
  },
  {
    id: "missing-person",
    topic:
      "missing person separated family child lost register reunite " +
      "lapata gum ho gaya bichhad gaya bachcha kho gaya register milana",
    title: "Someone is missing after a disaster",
    body:
      "Report to the district control room and the nearest relief camp — both keep separate " +
      "registers, and families are reunited more often through camp lists than police records. " +
      "Give a recent photograph, what they were wearing, and any medical condition. Children " +
      "travelling alone must be registered at the camp on arrival and not moved on before family " +
      "tracing has begun. Do not assume the person went home; check camps on both sides of the " +
      "affected area.",
    source: "NDMA guidance on family tracing and reunification",
    reference: "NDMA relief camp registration guidance",
    audience: "citizen",
    phase: "after",
  },
  {
    id: "livestock",
    topic:
      "livestock cattle animals flood cyclone save fodder loss compensation " +
      "pashu janwar gaay bhains baadh bachana chara nuksan muavza",
    title: "Livestock in a flood or cyclone",
    body:
      "Untie animals before the water arrives — tied animals drown. Move them to identified high " +
      "ground with fodder and water stored in advance; the fodder shortage after the water, not " +
      "the water itself, kills most surviving animals. Do not go back into moving water for " +
      "livestock. Record losses with photographs and the animal's details, as SDRF assistance for " +
      "livestock requires enumeration by the district administration.",
    source: "NDMA / SDRF norms of assistance — animal husbandry",
    reference: "SDRF item 3",
    audience: "citizen",
    phase: "before",
  },
];

export interface ProtocolHit extends Protocol {
  score: number;
}

const STOP = new Set([
  "the", "a", "an", "is", "are", "of", "for", "to", "in", "on", "what", "how",
  "kya", "hai", "ka", "ki", "ke", "me", "mein", "aur", "kitna", "kitne",
  "milta", "milega", "hota", "hota", "gaya", "gayi", "karo", "batao", "koi",
  "poora", "pura", "kaise", "kaun", "kab", "toh", "par", "bhi", "yeh", "woh",
]);

/** Keyword scoring — deliberately simple, and it never invents a figure. */
/**
 * Who is asking.
 *
 * "Ghar tut gaya to kitna muavza milta hai" and "paani aa raha hai, kya karun"
 * are both flood questions with completely different right answers — one is an
 * entitlement, the other is where to run. Guessing from phrasing is imperfect,
 * so it only biases the ranking rather than filtering: a wrong guess still
 * returns the other audience's entry, just below.
 */
function inferAudience(q: string): "citizen" | "coordinator" | null {
  const t = q.toLowerCase();

  // First person, present tense, asking what to do — a person in it.
  if (
    /\b(i|me|my|we|us|our)\b/.test(t) ||
    /\b(main|mein|mujhe|hum|humein|mera|meri|hamara)\b/.test(t) ||
    /\b(kya karun|kya karein|kya karna|what should i|what do i|how do i|where do i|am i safe)\b/.test(t)
  ) {
    return "citizen";
  }

  // Administrative vocabulary — someone running the response.
  if (
    /\b(sop|procedure|protocol|norms?|entitle|compensation|assistance|guideline|standard)\b/.test(t) ||
    /\b(muavza|muaawza|prakriya|niyam|maandand)\b/.test(t)
  ) {
    return "coordinator";
  }
  return null;
}

export interface LookupOptions {
  limit?: number;
  /** Force an audience instead of inferring it from the phrasing. */
  audience?: "citizen" | "coordinator";
  /** Restrict to one hazard family — used when answering about a live alert. */
  hazard?: string;
  phase?: "before" | "during" | "after";
}

export function lookupProtocol(query: string, options: number | LookupOptions = {}): ProtocolHit[] {
  // Callers passed a bare limit before this grew options.
  const opts: LookupOptions = typeof options === "number" ? { limit: options } : options;
  const limit = opts.limit ?? 2;

  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));

  if (!terms.length) return [];

  const wantAudience = opts.audience ?? inferAudience(query);

  const pool = PROTOCOLS.filter(
    (p) => (!opts.hazard || p.hazard === opts.hazard) && (!opts.phase || p.phase === opts.phase),
  );

  const scored = pool
    .map((p) => {
      const haystack = `${p.topic} ${p.title} ${p.body}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (p.topic.includes(t)) score += 3; // topic keywords are the curated index
        else if (haystack.includes(t)) score += 1;
      }
      // A nudge, not a filter — enough to order two equally-matching entries,
      // never enough to hide the one the asker actually needed.
      if (score > 0 && wantAudience) score += p.audience === wantAudience ? 2 : 0;
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

/**
 * The nearest hazard family that has guidance.
 *
 * The feed issues more hazard types than anyone can write separate advice for,
 * and several share the same answer. A flash flood warning and a cloudburst
 * warning mean the same thing to the person under them. Returning nothing at
 * all for "Squally weather" while holding perfectly good wind guidance is the
 * wrong kind of precision.
 */
const HAZARD_FALLBACK: Record<string, string> = {
  flashflood: "flood",
  cloudburst: "flood",
  rain: "rain",
  thunderstorm: "storm",
  squall: "wind",
  gale: "wind",
  alert: "rain",
};

/** Everything published for one hazard, ordered before → during → after. */
export function protocolsForHazard(hazard: string, audience?: "citizen" | "coordinator"): Protocol[] {
  const order = { before: 0, during: 1, after: 2 };
  const pick = (h: string) =>
    PROTOCOLS.filter((p) => p.hazard === h && (!audience || p.audience === audience)).sort(
      (a, b) => (order[a.phase ?? "during"] ?? 1) - (order[b.phase ?? "during"] ?? 1),
    );

  const direct = pick(hazard);
  if (direct.length) return direct;

  const fallback = HAZARD_FALLBACK[hazard];
  return fallback ? pick(fallback) : [];
}
