# NDLS Wayfinder

Passengers at New Delhi Railway Station scan a QR board, pick where they want to go (AC lounge, waiting room, toilets, platform…) and get a 3D walk-through with step-by-step directions and real photos. Commercial Branch staff sign in to keep facilities, QR boards and photos up to date.

It is one Next.js 14 app that works three ways:

| Who | How they get it |
|---|---|
| Passenger | Scans the QR board with the phone camera. The app opens in the browser at once, with nothing to install. |
| Passenger who wants it kept | "Add to Home screen" (Android Chrome or iPhone Safari). It then opens like an app and keeps working with a weak signal. |
| Staff / demo phones | Android APK built from the live site (see *Android app* below). |

---

## 1. Try it on your laptop (5 minutes)

```bash
cd ndls-wayfinder
npm install
npm run dev            # open http://localhost:3000
```

- Passenger view: `http://localhost:3000/#pg-gate5` (Gate 5, Paharganj side)
- Staff sign-in: `http://localhost:3000/staff`. The password is in `.env.local` (`ndls-demo`).

Without any cloud keys the app keeps its data in `.data/` on your laptop and starts with the 39 facilities and 15 QR points from the prototype.

> Phones on the same Wi-Fi can open `http://<your-laptop-IP>:3000`, but browsers only allow the **camera and GPS on https**. For a demo on real phones, deploy to Vercel first (next section). It takes about 10 minutes.

---

## 2. Go live on Vercel

Hosting is on Vercel (free Hobby plan). Data and photos are kept in Supabase (free plan). Upstash Redis + Vercel Blob also work if you prefer them; see `.env.example`.

1. **Put the code on GitHub** (a private repo is fine):
   ```bash
   git init && git add . && git commit -m "NDLS Wayfinder"
   gh repo create ndls-wayfinder --private --source . --push
   ```
2. **Create the Vercel project:** vercel.com, then *Add New, Project*, then import `ndls-wayfinder`. Framework: Next.js (detected).
3. **Create a free Supabase project** (no card needed) at **supabase.com**, then *New project*. Region **South Asia (Mumbai)**. Save the database password somewhere safe.
4. **Set up the table and photo bucket:** in Supabase open *SQL Editor*, then *New query*, paste the contents of `supabase-setup.sql` and click **Run**. Then in *Project Settings, then API*, copy the **Project URL** and the **service_role / secret key**, and add them in Vercel (*Settings, then Environment Variables*) as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
5. **Set the staff password:** *Settings, then Environment Variables*:
   - `ADMIN_PASSWORD`: a strong password for Commercial Branch staff
   - `AUTH_SECRET`: any long random text (e.g. run `openssl rand -hex 32`)
6. **Deploy** (or redeploy after adding the variables). Functions run in Mumbai (`vercel.json`).
7. **Open the site:** the first visit loads the starter data into Redis automatically.
8. **Optional: own address.** *Settings, then Domains* (e.g. `wayfinder.<your-domain>`). Decide the final address **before printing QR boards**, because the codes contain it.

Or from the terminal: `npx vercel link`, then `npx vercel --prod`.

### Check it's working
- `https://<your-site>/api/me` should show `"store":"supabase","photos":"supabase","login":true`.
- Sign in at `/staff`, edit any facility and save. Then open the site on another phone; it shows the change within 30 seconds.

---

## 3. Record the real station (Site survey)

Do this on site, before printing QR boards. Sign in at `/staff` on a phone and open **Site survey**. Tap **Show my location**.

For each place below, stand on the spot, tap **Add point where I'm standing**, wait for the GPS reading, then drag the orange **+** pin to the exact spot on the satellite map and **Save point**. Under a roof the GPS can be 20–30 m out, so always check the pin.

1. **Platform ends and pillars.** Platforms 2/3 … 14/15 are island platforms and are recorded once. Stand at both ends of every platform and say which end it is (**Sadar Bazar end** or **Nizamuddin end**); the table shows what is still missing. These names are for staff only: passengers are told "towards the Gate 1 end" / "Gate 5 end" instead. Then add **Pillar** points every 50–100 m along each platform with the pillar number, so passengers are told "near pillar 23".
2. **Gates and entries.** Stand in every numbered gateway (number, side, use). Record station entrances that are not numbered gates as **Station entry** with a name, e.g. *Main entrance* or *Metro entry*.
3. **Foot over bridges.** Walk each bridge from one end to the other. Add a point at the start, at every turn, and at every stairs, lift or escalator. Where one spot has several ways down (stairs to Platform 1 **and** a way out to the Paharganj concourse; stairs on both sides of an island platform), tap **Add a way down** for each one and say where it leads, which side it goes down (towards the Sadar Bazar or Nizamuddin end) and whether it is stairs, lift or escalator. Points are joined in the order you record them. For a branch (a second way off a point, or a bridge that starts from another bridge), set **Joins the bridge at** to the point it branches from. If a point joins several others (e.g. B3-9 to B3-10 **and** to B2-7), add the extra ones under **Also connected to**.
4. **Amenities.** Stand at the entrance and add an **Amenity or facility** point: catering stalls, Jan Ahaar, water booths, toilets, waiting rooms, booking counters, ATVMs, enquiry, book stalls, wheelchair points… For anything on a platform, pick the platform and the nearest pillar number so it stays on the right platform even when the GPS is unsure.
4a. **Construction sites / work areas.** Stand in the middle of the work and add a **Construction site / work area** point: what is happening, where (platform + pillar, concourse or bridge), whether passengers can pass (**closed** areas are routed around; **partly blocked** areas give a warning in the directions), the size, and the expected finish date (ignored automatically after that date). Delete the point when the work is over.
5. **Build.** When the checklist says *Ready*, tap **Build station model**. It opens in **Station layout**: check the preview, tap **See it in 3D**, then **Save layout**.
6. **Move QR boards and facilities.** Back in **Site survey**, tap **Move … now**. QR boards and facilities with a GPS reading (and gate boards, by their gate number) move onto the surveyed layout. Re-place the rest on site.

After the first build and save, the station layout **updates itself**: every point you save or delete in the survey rebuilds the model passengers use within a few seconds, and QR boards made from survey points move with their point. You can switch this off in Site survey (**Update the station layout automatically**) and update by hand with **Update now**. Automatic updates pause while there are unsaved changes in Station layout.

---

## 4. Print the QR boards

1. Sign in at `/staff`, open **QR points**.
2. Check the *Passenger page link* shows your live address.
3. **Download all (ZIP)** gives one A5 sign per board (PNG, 1200×1760, Hindi on top and English below) plus a CSV of IDs, coordinates and links.
4. Print on weatherproof stock at A5 or larger. Fix at eye level near the spot the board was created for.

To add a board: choose **New QR point**. If the spot was recorded in the Site survey, pick it under **Take from site survey**: the Hindi and English names, the type and the exact surveyed coordinates are filled in. Otherwise stand there, tap **Use my current location** and check the pin on the map. Then **Save and make QR**.

---

## 5. Android app (APK)

The APK wraps the live site, so it always shows current data and needs no separate updates.

1. Go to **https://www.pwabuilder.com**, enter your live address and click *Start*.
2. *Package for stores*, then *Android*, then *Generate*. Keep the default options (package ID e.g. `in.gov.nr.ndlswayfinder`).
3. Download the ZIP. It contains:
   - an **APK** to install on demo phones (allow *Install unknown apps* on the phone)
   - an **AAB** for the Play Store
   - `assetlinks.json` plus a **signing key**. **Keep the key safe**; you need it for every future update.
4. Copy the contents of `assetlinks.json` into the Vercel variable `ANDROID_ASSETLINKS` and redeploy. The app then opens full-screen with no browser bar (served at `/.well-known/assetlinks.json`).
5. Play Store (optional): a Google Play developer account (one-time fee), then upload the AAB. For a public railway app this should be published under the official Northern Railway / CRIS developer account.

**iPhone:** open the site in Safari, then *Share*, then *Add to Home Screen*.

---

## 6. Demo script (about 10 minutes)

1. **Scan.** On a phone, scan the printed Gate 5 board with the normal camera app. The page opens with "You are here: Gate 5".
2. **Choose.** Tap **AC Lounge**. All three lounges appear with distance and walking time, with the nearest marked.
3. **Route.** Pick *AC Lounge, PF 16*. Tap **Walk it**: the 3D walk crosses Foot Over Bridge 2 and takes the lift down. Turn on **Step-free route** to show the lift-only path.
4. **In-app scan.** Tap **Scan QR code** and scan another board; "You are here" updates.
5. **Staff update.** On a second phone, sign in at `/staff`, open **Facilities**, set the PF 1 Executive Lounge to *Closed* with a note. Within 30 seconds the passenger phone greys it out and routes to the next lounge.
6. **Photo.** In **Photos**, add a photo at the escalator and tap where to go. It appears on that step of the walk, and as a yellow-framed board inside the 3D model (tap it to enlarge).
7. **Layout.** In **Station layout**, mark Gate 2 as closed or move a foot over bridge, tap **See it in 3D**, then **Save layout**. Passenger phones redraw the station within 30 seconds.
8. **Offline.** Turn on airplane mode. The app still opens and shows the last station data.

---

## 7. Before public launch: checklist

- [ ] Station layout: record the station in **Site survey** (section 3), build and save the model, then move QR boards and facilities onto it. Check the Passenger 3D view.
- [ ] GPS calibration: save GPS (tapped on the map by hand) on **at least 3 QR points** spread across the station.
- [ ] Facilities: walk the station, check each facility's position, status and entrance photo.
- [ ] Photos at the main turning points (gates, FOB stairs/lifts/escalators).
- [ ] Change `ADMIN_PASSWORD` from anything used in demos; share it only with Commercial Branch staff.
- [ ] Approvals: confirm hosting and publishing with the Division's IT / CRIS policy (data is non-personal; servers in Mumbai).
- [ ] Final domain chosen, then print boards.

---

## How it's built

```
app/page.js               passenger + staff screens (one page, client-side)
app/staff/page.js         staff sign-in
app/api/data              GET all facilities, QR points, photos, station layout (public)
app/api/[col]/[id]        PUT / DELETE one record (staff only)
app/api/upload            photo upload to Vercel Blob (staff only)
app/api/login|logout|me   staff session (signed httpOnly cookie)
app/manifest.js           installable app manifest
public/sw.js              offline cache (app shell, station data, photos)
lib/wayfinder-app.js      routing, 3D walk, editors, site survey
lib/runtime.js            browser data layer, polls /api/data every 30 s
lib/scanner.js            in-app camera QR scanner
lib/store.js              Supabase (or Upstash Redis), or a local JSON file when no keys are set
lib/supabase.js           server-side Supabase client
supabase-setup.sql        one-time table + photo bucket setup
lib/seed.json             starter data loaded on first run
```

Requires Next.js 16 (route params are awaited, so Next 14 also works). Run `npm install` after pulling changes.

Data is stored in the Supabase table `wf_docs` (one row per record: `col`, `id`, `data` JSON). Photos are public URLs in the Supabase Storage bucket `photos`.

Note: Supabase pauses free projects after about a week with no visits. Passenger use keeps it awake; if it does pause, click *Restore* in the Supabase dashboard.

## Real map, outside areas and live navigation

**Station layout → Real map.** Draws the station at its surveyed GPS positions over satellite, street map or a plain plan (switch with the layers button, top right): each platform from its two recorded ends (true length and angle; island platforms wider), every foot over bridge from its bridge points (with each stairs / lift / escalator), gates and entries coloured by use, pillar numbers (zoom in), amenities, construction areas and everything outside the station. Tap anything for its details. The panel beside the map lists the measured length of every platform and bridge and the size of every outside area. **Diagram & editor** is the earlier simplified layout, still used for directions and for fine-tuning gates.

**Site survey → Outside the station.** For parking areas, roads, drop-off / pick-up zones, forecourts, taxi and auto stands, bus stops, metro entrances and buildings. Areas and roads are drawn by adding corners: walk to each corner and tap *Add corner where I'm standing*, or tap *Add corners by tapping the map* and tap them on the satellite map. Single places (a taxi stand) are one spot. These are for mapping only and don't change passenger directions.

**Passenger → Live map.** The route on the real map. *Start live navigation* asks for location access, then a blue dot follows the phone, the walked part of the route turns grey, the banner shows the current instruction, the distance to the next one and what comes after, and the matching step is highlighted below. It warns when the passenger is off the route and says when they have arrived. GPS under roofs and bridges can be off by 20 to 50 m, so the steps and signs remain the reference. The map stays north-up; the cone on the blue dot shows which way the phone is facing.

**3D walk.** "Follow me" now walks at eye level behind the passenger (below the bridge decks and platform canopies), and anything that comes between the camera and the walker (a bridge, stairs, a lift) turns see-through, so the walker and the blue route stay in view. Parking areas, roads, drop-off zones, forecourts, buildings and taxi / bus / metro stands recorded under *Site survey → Outside the station* are drawn around the station. When a facility has a photo (Photos tab), a framed photo board stands above that stall in 3D for stalls near the route; tap it to enlarge.

## Tell us (passenger feedback) and Gate duty

Both use the **same QR boards**. After scanning, the passenger sees two buttons: **रास्ता देखें · Directions** and **हमें बताएं · Tell us**, plus a small **Railway staff: gate duty** link. The printed sign reads "SCAN FOR DIRECTIONS · TELL US" while Tell us is on.

### Switching them on or off
**Control room → Staff & settings → Features** has a separate switch for each (admin password, or a staff account with *Manage staff & settings*).
- **Tell us off:** no choice screen after scanning (passengers go straight to directions), no *Tell us* button, the Tell us tab disappears from the Control room, `/tell` shows "Not available right now", and new messages are refused by the server. Messages already received are kept.
- **Gate duty off:** no gate-duty link, the Gate board and Duty log tabs disappear, `/duty` shows "Not available right now", and duty scans are refused by the server. Past duty records are kept.
- Changes reach phones within a minute.

### Tell us (`/tell?p=<board>`)
- Passenger picks a topic (cleanliness, toilets, water, staff behaviour, catering, appreciation…), writes a few words, can add a photo and a mobile number.
- The board's place is filled in automatically. They get a reference number like `T261018-K7MA` and can check its status (and any reply you choose to show) from the same page.
- Staff see messages in **Control room → Tell us**, only for the topics they are given, plus anything forwarded to them. Status: Received → Being looked into → Resolved (a remark is needed to resolve).

### Gate duty (`/duty?p=<board>`)
- Each ticket checking staff member has their own account: PF/HRMS number + own PIN.
- **Adding staff:** Control room → Staff & settings → Add. A one-time 6-digit setup code is shown once (valid 7 days). The staff member scans any gate QR → Railway staff: gate duty → **First time** → enters PF + code, chooses a PIN, takes a reference photo of their face.
- At the gate: **Join duty**, **Leave the gate** (reason required; "Other" needs a written reason), **Rejoin**, **End duty**. Every action needs a live front-camera photo taken in the app (no gallery), with time and gate printed on it, and the phone's location.
- Checks recorded (not blocking): more than the set distance from the gate (default 75 m, needs the board's GPS position), no location, a phone that isn't theirs, other gate.
- **Control room → Gate board** refreshes every 20 s: Manned / Unmanned (staff away) / No staff. Anyone away longer than the alert time (default 15 min) turns the gate red and appears in the alert banner at the top; the browser tab title shows the count. Tap a photo to compare it with the reference photo.
- **Duty log**: per day, per person time away and reasons, every scan with photo, CSV download for Excel.

### Who can do what
- **Admin password** (`/staff`): everything, including adding staff and the feature switches.
- Staff accounts get any mix of: Gate duty · See gate board & duty log · Manage staff & settings · Tell us topics (all or chosen).

### Data
Accounts, duty records, messages and the feature switches are stored in the same `wf_docs` table under private collection names (`users`, `dutynow`, `duty`, `fb`, `config`) and are never sent by `/api/data`. Photos go to the private `private` bucket and are only served to signed-in staff.

## AR view (camera navigation)

After choosing a destination, passengers tap **📷 AR view**, stand in front of the QR board they scanned (facing it) and tap **Start AR**.

- **Android phones with ARCore, in Chrome:** full AR. Blue arrows are laid on the floor along the route (rising up the bridge stairs), with a sign at each step and a yellow pin at the destination. The phone's own tracking follows the walk; the banner shows the current step, the distance to the next one and what comes after. ⟲ ⟳ turn the arrows a few degrees if they don't line up with the corridor.
- **iPhone and other phones:** camera view with a guiding arrow steered by the compass, the current step and the distance (from GPS, or tap **Next step ▸**). It shows "Turn around" when the route is behind you.
- **Set up each board once:** QR points → edit the board → **3 · Which way the board faces** → stand in front of the board, point the phone at it, tap **Read phone compass** → Save. AR uses this direction to line up the arrows (the phone's compass is used if it's missing, which is less accurate near steel structures).
- Tracking drifts by about 1–2 % of the distance walked. For long routes, scan the next QR board on the way and start AR again from there.

### Adjusting shapes in the Site survey
Open any parking area, road, drop-off zone or other outside area with **Edit** (or tap it on the map); the map zooms to it.
- **Drag a numbered corner** to move it.
- **Tap +** between two corners to add a corner there (it is selected, so you can drag it straight away).
- **Tap a corner** to select it, then **Delete corner** in the panel (an area keeps at least 3, a road at least 2).
- **Drag ✥** to move the whole shape.
- While drawing, every tap on the map adds the next corner; **Undo last** removes it.

**Construction sites** are a circle: drag the orange **+** to move it and the **↔** handle on its edge to make it bigger or smaller, or type the radius in metres.

**Colour.** Every outside area and construction site has *Colour on the maps*: pick one of ten colours, **Other…** for any colour, or **Default** for the standard colour of its type. The colour is used on the survey map, the Real map, the Live map, the 3D view and (for construction sites) the station map.

**How many.** Facilities have *How many* and *Of what* (counters, machines, windows, booths, taps, stalls, seats, beds, units), in both the Facilities editor and the Site survey. The unit is suggested from the type and name (UTS / PRS / Enquiry → counters, ATVM → machines). Passengers see it as a tag in the list ("6 counters") and in the route heading; it also shows in the Facilities list and on the Real / Live map cards.

**Full screen while editing.** ⤢ Full screen on the Site survey map and on the Station layout diagram now keeps the editing panel beside the map (below it on a phone), so points can be added, edited and saved without leaving full screen.

**Platform lines with bends.** In Site survey → *Platform ends and pillars*, each platform has **Adjust**. The platform's line is shown from its Sadar Bazar end to its Nizamuddin end: tap **+** on the line to add a bend point, drag any point (the ends too) to where the platform really runs, tap a bend point and **Delete** it, then **Save platform line**. Bend points can also be recorded on site as *Bend point on a platform line*. The Real map and Live map draw the platform through its bend points and show its true length; the 3D walk and the station diagram keep platforms straight.

## 3D: concourse amenities and "where am I"
- An amenity recorded in the Site survey **without a platform** is never placed on a platform. Beyond PF 1 it belongs to the Paharganj side concourse, beyond PF 16 to the Ajmeri Gate side; between platforms only a foot over bridge is allowed. If an amenity really is on a platform, set "On a platform?" in its survey point.
- In 3D such amenities stand at their real surveyed spot. Ones beyond the station wall (e.g. Yatri Suvidha Kendra) show outside with an OUTSIDE tag, and the route walks out through the nearest gate to them.
- A chip at the top left of the 3D view always says where the walker is: on a platform, on which foot over bridge (upstairs, above which platform, up from where and down to where), in a concourse or outside.
- The bridge(s) the route uses are coloured, with "UP TO FOB …" and "DOWN TO …" signs where the route climbs and comes down.

## ATM and new facility types
- **ATM** is a built-in type (passengers see it as a category; "How many" defaults to machines).
- In **Facilities → Type**, pick **+ Add a new type…** and type its name (e.g. Mobile Charging). It is saved with the facility and then appears in the Type list, the passenger categories and the survey's "What is here?" list. Typing a name that already exists reuses that type.

## 3D drawn from the real station (survey + satellite)
- **Satellite picture on the ground.** The 3D view lays the real satellite photo (Esri World Imagery, the same as the station map) under the station, lined up with the survey. A **Satellite** button (top right of the 3D view) turns it off and on; the choice is remembered on that phone.
- **Real gates and building front.** Each gate stands at its surveyed spot. The concourse building on each side is drawn from the gates to the platform: floor, front wall with an opening at every gate, light roof. Entry-only / exit-only / closed tags show on the gates.
- **Real platform lengths.** Each platform is drawn from its surveyed ends (bends count too), with "PF … END" markers.
- **Amenities outside the building** (e.g. ATMs in the forecourt) are shown at their recorded spot. The route leaves by the best gate passengers are allowed to **exit** by (entry-only and closed gates are skipped), with a "Go out through Gate …" step and a note when redevelopment work is nearby.
- **Construction sites.** In the survey's "Outside the station" kinds there is now **Construction / redevelopment site**. Any outside area named "construction" or "redevelopment" is also drawn as a site with orange-and-white hoarding in 3D.

## Navigate (turn-by-turn, Hindi voice)
- After picking a destination, tap **▶ Navigate · नेविगेट करें** (also the Start button on the Live map). A full-screen map opens, like a street-map app: green instruction banner with the turn arrow and distance, "फिर / Then" for the next turn, minutes and metres left with arrival time, and an Upstairs / Ground level chip.
- **Start · शुरू करें** follows the phone's GPS. The arrow is kept on the route, the map turns and tilts with the direction of walking, and drags pause the follow (tap **Re-centre · वापस**). Off the route by more than ~30 m, it says so and asks to walk back to the blue line.
- **Voice in Hindi (default) or English** (हिं / EN button; 🔊 to mute): about 40 m before and at each turn — दाएँ / बाएँ / थोड़ा दाएँ / पीछे मुड़ें, सीढ़ियाँ चढ़ें / उतरें, लिफ्ट / एस्केलेटर लें, गेट नंबर … से बाहर निकलें, प्लेटफॉर्म … पर जाएँ, and arrival. Uses the phone's own speech voices (Hindi needs a Hindi voice, present on most Android phones and iPhones).
- **Demo walk · डेमो** walks the route by itself (1×, 3×, 6×), for showing it in the office or where GPS is weak.
- Map: free street map (OpenFreeMap) or satellite (🛰 button). The screen is kept awake while navigating where the phone allows.
- Needs the `maplibre-gl` package (added to package.json). Vercel installs it on deploy; for local runs do `npm install` once.

## Station outline and walking paths (indoor-map look)
- The station building is outlined with a **blue boundary line** and a light-blue fill, and all walking paths (concourses, platforms, bridges) are drawn as thin blue lines, on the Navigate map, the Live map, the staff Real map and (as a blue line on the ground) in 3D. Amenities show as coloured dots by type.
- Until staff draw it, the outline is worked out from the survey (platform ends, bridges, gates, facilities inside), pushed out 8 m.
- To set the exact outline: Site survey → add a point → What is here: **Outside the station** → kind **Station building (boundary)**. The corners start from the worked-out outline; drag them onto the real building edges on the satellite map (add or remove corners as for any area) and save.
