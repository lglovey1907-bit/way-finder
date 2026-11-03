// Server-side helpers for the public facility pages (Google search). Kept in step with lib/wayfinder-app.js.
import { getAll } from '@/lib/store';
export const CATS=[
 // A. Passenger facilities
 ['ticket','UTS & PRS counters','टिकट काउंटर (यूटीएस / पीआरएस)','B','A'],['ysk','Yatri Suvidha Kendra','यात्री सुविधा केंद्र','Y','A'],
 ['waiting','Waiting Room','प्रतीक्षालय','W','A'],['lounge','AC Lounge','एसी लाउंज','L','A'],['retiring','Retiring Rooms','विश्रामालय','R','A'],
 ['toilet','Toilets','शौचालय','T','A'],['water','Drinking Water','पेयजल','D','A'],['cloak','Cloak Room','अमानती घर','C','A'],
 ['food','Catering & Food','खानपान','F','A'],['mih','May I Help You booth','मे आई हेल्प यू बूथ','?','A'],['help','Wheelchair & Porter','व्हीलचेयर व कुली','H','A'],
 ['atm','ATM','एटीएम','₹','A'],['shop','Shops & Book Stalls','दुकानें व बुक स्टॉल','S','A'],['pharmacy','Chemist','दवा की दुकान','+','A'],
 ['charging','Mobile Charging','मोबाइल चार्जिंग','⚡','A'],['feeding','Baby Feeding Room','शिशु आहार कक्ष','B','A'],
 // B. Navigation points
 ['platform','Platform','प्लेटफॉर्म','','B'],['gate','Entry & Exit Gates','प्रवेश व निकास द्वार','G','B'],['pfentry','Platform Entrances','प्लेटफॉर्म प्रवेश','P','B'],
 ['fobaccess','Foot Over Bridge Access','फुट ओवर ब्रिज पहुँच','F','B'],['subway','Subway Entrances','सबवे प्रवेश','U','B'],['lift','Lifts','लिफ्ट','L','B'],
 ['escalator','Escalators','एस्केलेटर','E','B'],['stairs','Stairs & Ramps','सीढ़ियाँ व रैंप','S','B'],['parking','Parking Entrances','पार्किंग प्रवेश','P','B'],
 ['transport','Taxi, Auto & Metro','टैक्सी, ऑटो व मेट्रो','M','B'],['dropoff','Pick-up & Drop-off','पिक-अप व ड्रॉप','D','B'],
 // C. Operational points
 ['police','RPF / GRP Post','आरपीएफ / जीआरपी चौकी','R','C'],['sm',"Station Master's Office",'स्टेशन मास्टर कार्यालय','SM','C'],['enquiry','Enquiry Office','पूछताछ कार्यालय','i','C'],
 ['parcel','Parcel Office','पार्सल कार्यालय','P','C'],['cmi','Commercial Inspector Office','वाणिज्य निरीक्षक कार्यालय','CI','C'],['lostfound','Lost & Found','खोया-पाया','?','C'],
 ['medical','Medical Assistance','चिकित्सा सहायता','+','C'],['complaint','Complaint Desk (Rail Madad)','शिकायत डेस्क (रेल मदद)','!','C'],
 // D. Temporary points (shown only between their dates)
 ['tmpticket','Festival Special Ticket Counter','त्योहार विशेष टिकट काउंटर','B','D'],['holding','Passenger Holding Area','यात्री होल्डिंग क्षेत्र','H','D'],
 ['tmpgate','Additional Entry Gate','अतिरिक्त प्रवेश द्वार','G','D'],['tmpfood','Temporary Catering Unit','अस्थायी खानपान','F','D'],['tmphelp','Special Help Desk','विशेष सहायता डेस्क','?','D'],
 ['queue','Queue Arrangement','कतार व्यवस्था','Q','D'],['tmpwater','Temporary Water Point','अस्थायी पानी','D','D'],['tmptoilet','Mobile Toilets','मोबाइल शौचालय','T','D'],
 // E. Authority-defined points
 ['newfac','New Facility','नई सुविधा','N','E'],['guide','Passenger Guidance Point','यात्री मार्गदर्शन बिंदु','→','E'],['diversion','Temporary Diversion','अस्थायी मार्ग परिवर्तन','↪','E'],
 ['restricted','Restricted Area (No Entry)','प्रतिबंधित क्षेत्र (प्रवेश वर्जित)','⛔','E'],['assembly','Emergency Assembly Point','आपातकालीन एकत्र स्थल','A','E'],
 ['emexit','Emergency Exit','आपातकालीन निकास','X','E'],['other','Other Point (Station Authority)','अन्य बिंदु (स्टेशन प्राधिकरण)','•','E']];
const HI_WORDS=[['yatri suvidha kendra','यात्री सुविधा केंद्र'],['pay & use','पे एंड यूज़'],['pay and use','पे एंड यूज़'],['jan ahaar','जन आहार'],['first aid','प्राथमिक चिकित्सा'],['help desk','सहायता केंद्र'],['post office','डाकघर'],['food plaza','फूड प्लाज़ा'],['food court','फूड कोर्ट'],
  ['ladies','महिला'],['gents','पुरुष'],['atvm','एटीवीएम'],['atm','एटीएम'],['uts','यूटीएस'],['prs','पीआरएस'],['irctc','आईआरसीटीसी'],['grp','जीआरपी'],['rpf','आरपीएफ'],['executive','एग्जीक्यूटिव'],['ac','एसी'],['bank','बैंक'],['current','करंट'],['normal','सामान्य'],
  ['booth','बूथ'],['medical','चिकित्सा'],['chemist','दवा की दुकान'],['pharmacy','दवा की दुकान'],['wheelchair','व्हीलचेयर'],['taxi','टैक्सी'],['auto','ऑटो'],['tea','चाय'],['coffee','कॉफ़ी'],['canteen','कैंटीन'],['restaurant','रेस्टोरेंट'],['food','भोजन'],['shop','दुकान'],
  ['book','पुस्तक'],['dormitory','डॉरमेट्री'],['mobile','मोबाइल'],['charging','चार्जिंग'],['police','पुलिस'],['parcel','पार्सल'],['room','कक्ष'],['machine','मशीन'],['kiosk','कियोस्क'],['washroom','शौचालय'],['urinal','मूत्रालय'],['bath','स्नानघर'],['enquiry','पूछताछ'],
  ['foot over bridge','फुट ओवर ब्रिज'],['main entrance','मुख्य प्रवेश द्वार'],['sadar bazar end','सदर बाज़ार छोर'],['nizamuddin end','निज़ामुद्दीन छोर'],['ajmeri gate side','अजमेरी गेट साइड'],['paharganj side','पहाड़गंज साइड'],
  ['booking office','बुकिंग कार्यालय'],['reservation','आरक्षण'],['waiting room','प्रतीक्षालय'],['waiting hall','प्रतीक्षालय'],['catering stall','खानपान स्टॉल'],['drinking water','पेयजल'],['ajmeri gate','अजमेरी गेट'],['entry & exit','प्रवेश व निकास'],
  ['exit only','केवल निकास'],['entry only','केवल प्रवेश'],['sadar bazar','सदर बाज़ार'],['nizamuddin','निज़ामुद्दीन'],['paharganj','पहाड़गंज'],['platform','प्लेटफॉर्म'],['pillar','खंभा'],['gate','गेट'],['fob','एफओबी'],['entrance','प्रवेश द्वार'],['entry','प्रवेश'],['exit','निकास'],
  ['metro','मेट्रो'],['parking','पार्किंग'],['main','मुख्य'],['hall','हॉल'],['concourse','कॉनकोर्स'],['enquiry','पूछताछ'],['counters','काउंटर'],['counter','काउंटर'],['toilets','शौचालय'],['toilet','शौचालय'],['lounge','लाउंज'],['stairs','सीढ़ियाँ'],
  ['lift','लिफ्ट'],['escalator','एस्केलेटर'],['middle','मध्य'],['end','छोर'],['side','साइड'],['closed','बंद'],['new','नया'],['and','व'],['ticket','टिकट'],['booking','बुकिंग'],['office','कार्यालय'],['water','पानी'],['stall','स्टॉल'],['cloak room','अमानती घर'],['retiring room','विश्रामालय']];

export const CAT = {}; CATS.forEach((c) => (CAT[c[0]] = { id: c[0], en: c[1], hi: c[2] }));
export const SITE = (process.env.SITE_URL || 'https://amenities-wayfinder.vercel.app').replace(/\/$/, '');
export function hiAuto(en) {
  let t = ' ' + String(en || '') + ' ';
  HI_WORDS.forEach(([e, h]) => { t = t.replace(new RegExp('(^|[^a-z])' + e.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&') + '(?=[^a-z]|$)', 'gi'), (m, p) => p + h); });
  t = t.trim(); return /[ऀ-ॿ]/.test(t) ? t : '';
}
export const facHi = (a) => String((a && a.nameHi) || '').trim() || hiAuto(a && a.name) || '';
const pfText = (n) => (n <= 1 ? 'Platform 1' : n >= 16 ? 'Platform 16' : `Platform ${n}`);
export function whereText(a, fobs = {}) {
  const out = [];
  const ar = String(a.area || '');
  if (ar === 'P') out.push('Paharganj side concourse');
  else if (ar === 'A') out.push('Ajmeri Gate side concourse');
  else if (a.pf) out.push(pfText(+a.pf));
  else if (ar.startsWith('pl')) { const b = +ar.slice(2); out.push(b === 0 ? 'Platform 1' : b === 8 ? 'Platform 16' : `Platform ${2 * b}/${2 * b + 1}`); }
  else if (fobs[ar]) out.push(String(fobs[ar].name || 'Foot over bridge'));
  if (a.pillar) out.push(/pillar/i.test(a.pillar) ? String(a.pillar).replace(/-/g, ' ') : 'Pillar ' + a.pillar);
  return out.join(' · ');
}
export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export async function loadPlaces() {
  const all = await getAll();
  const fobs = {}; try { ((all.layout && (all.layout.main || Object.values(all.layout)[0]) || {}).fobs || []).forEach((f) => (fobs[f.id] = f)); } catch (_) {}
  return Object.entries(all.facilities || {})
    .map(([id, a]) => ({ ...a, id, cat: ({ 'x-yatra-suvidha-kendra': 'ysk', 'x-road-to-yatri-suvidha-ke': 'guide' })[a.cat] || a.cat, hi: facHi(a), where: whereText(a, fobs), kw: Array.isArray(a.kw) ? a.kw : [], aliases: Array.isArray(a.aliases) ? a.aliases : [] }))
    .filter((a) => a.name && CAT[a.cat] && a.cat !== 'platform' && !['restricted', 'diversion'].includes(a.cat) && !(a.until && Date.parse(a.until) < Date.now()) && !(a.from && Date.parse(a.from) > Date.now()));
}
