"use strict";

const $ = id => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const siteDefault = { lat: 51.4779, lon: -0.0015, elevation: 46, name: "Greenwich Observatory" };
let site = siteDefault;
try {
  const saved = JSON.parse(localStorage.getItem("meridian-site"));
  if (saved && [saved.lat, saved.lon, saved.elevation].every(Number.isFinite)) site = saved;
} catch { /* The app also works without browser storage. */ }
let instant = new Date(), live = true, selected = "", positions = [], track = [], generation = 0;
let corridorGeneration = 0, pendingSky = false;
let previousObservation = null;
const titles = { sky: "Observer’s sky", events: "Passes & transits", archive: "Orbit archive" };
const activeView = () => Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : "sky";
const shortUTC = value => new Date(value).toISOString().replace("T", " ").slice(0, 19) + " UTC";
const preciseUTC = value => new Date(value).toISOString().replace("T", " ").replace("Z", " UTC");
const stamp = value => new Date(value).toISOString().slice(0, 19);
const degrees = n => Number.isFinite(n) ? n.toFixed(1) + "°" : "—";
const isISS = name => /^ISS\b/i.test(name);
const element = (tag, value, cls) => {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (cls) node.className = cls;
  return node;
};
function svg(parent, tag, attrs, value) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val);
  if (value != null) node.textContent = value;
  parent.append(node);
  return node;
}
async function api(path, params, payload) {
  if (window.browserApi) return window.browserApi(path, params, payload);
  const url = new URL("/api/" + path, location.origin);
  if (params) url.search = new URLSearchParams(params);
  const response = await fetch(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {});
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed (" + response.status + ")");
  return data;
}
function parameters(at = instant) {
  return { lat: site.lat, lon: site.lon, elevation: site.elevation, at: at.toISOString() };
}
function syncClock() {
  $("when").value = stamp(instant);
  $("now").setAttribute("aria-pressed", String(live));
  $("now").title = live ? "Following the current time" : "Return to the current time";
  $("scrub").value = instant.getUTCHours() * 60 + instant.getUTCMinutes();
  $("scrub-value").textContent = stamp(instant).slice(11, 16);
}
function setTime(value, follow = false) {
  if (!Number.isFinite(value.getTime())) return;
  instant = value;
  live = follow;
  track = [];
  syncClock();
  loadView();
}
function syncSite() {
  $("site-name").textContent = site.name;
  $("site-lat").value = site.lat; $("site-lon").value = site.lon; $("site-elev").value = site.elevation;
}
function applySite(lat, lon, elevation) {
  site = { lat, lon, elevation, name: Math.abs(lat).toFixed(3) + "° " + (lat >= 0 ? "N" : "S") + " · " + Math.abs(lon).toFixed(3) + "° " + (lon >= 0 ? "E" : "W") };
  if (!previousObservation) {
    try { localStorage.setItem("meridian-site", JSON.stringify(site)); } catch {}
  }
  $("site-form").hidden = true;
  $("site-toggle").setAttribute("aria-expanded", "false");
  track = []; syncSite(); loadView();
}
$("site-toggle").onclick = () => {
  $("site-form").hidden = !$("site-form").hidden;
  $("site-toggle").setAttribute("aria-expanded", String(!$("site-form").hidden));
  if (!$("site-form").hidden) $("site-lat").focus();
};
$("site-form").onsubmit = e => {
  e.preventDefault();
  applySite(+$("site-lat").value, +$("site-lon").value, +$("site-elev").value);
};
$("geolocate").onclick = () => {
  if (!navigator.geolocation) { $("site-message").textContent = "Device location is unavailable. Enter coordinates above."; return; }
  $("site-message").textContent = "Locating your device…";
  navigator.geolocation.getCurrentPosition(({coords}) => {
    $("site-message").textContent = ""; applySite(coords.latitude, coords.longitude, coords.altitude ?? 0);
  }, err => { $("site-message").textContent = err.message; });
};
$("when").onchange = () => { if ($("when").value) setTime(new Date($("when").value + "Z")); };
$("back-day").onclick = () => setTime(new Date(+instant - 86400000));
$("forward-day").onclick = () => setTime(new Date(+instant + 86400000));
$("now").onclick = () => setTime(new Date(), true);
$("scrub").oninput = () => {
  const minute = Number($("scrub").value);
  $("scrub-value").textContent = [Math.floor(minute / 60), minute % 60].map(n => String(n).padStart(2, "0")).join(":");
};
$("scrub").onchange = () => {
  const time = new Date(instant); time.setUTCHours(0, Number($("scrub").value), 0, 0); setTime(time);
};

const cx = 260, cy = 229, radius = 193;
function chartPoint(alt, az) {
  const r = radius * (90 - alt) / 90, rad = az * Math.PI / 180;
  return [cx - r * Math.sin(rad), cy - r * Math.cos(rad)];
}
function renderChart() {
  const map = $("sky-map"); map.replaceChildren();
  const grid = svg(map, "g", { fill: "none", stroke: "#456167", "stroke-width": 1 });
  for (const alt of [0, 15, 30, 45, 60, 75]) {
    svg(grid, "circle", { cx, cy, r:radius * (90-alt)/90, opacity:alt % 30 === 0 ? .85 : .46, "stroke-dasharray":alt % 30 ? "2 5":"none" });
  }
  for (let az = 0; az < 360; az += 5) {
    const [x,y] = chartPoint(0,az);
    const [x2,y2] = chartPoint(az % 45 === 0 ? 90 : az % 15 === 0 ? 3 : 1.7,az);
    svg(grid,"line",{x1:x,y1:y,x2,y2,opacity:az%45===0?.52:.9});
  }
  for (const [label,az] of [["N",0],["E",90],["S",180],["W",270]]) {
    const [x,y] = chartPoint(-9,az);
    svg(map,"text",{x,y:y+5,fill:"#c5d5d2","text-anchor":"middle","font-size":15},label);
  }
  for (const alt of [30,60]) {
    const [x,y] = chartPoint(alt,0);
    svg(map,"text",{x:x+5,y:y-4,fill:"#8aa4a7","font-size":11},alt+"°");
  }
  const points = track.filter(p => p.alt >= 0).map(p => chartPoint(p.alt,p.az).join(","));
  if (points.length) svg(map,"polyline",{ points:points.join(" "), fill:"none", stroke:"#f4b670", "stroke-dasharray":"4 3", "stroke-width":2 });
  const seenLabels = [];
  const visible = positions.filter(obj => obj.alt >= 0).sort((a,b) => Number(b.name === selected) - Number(a.name === selected));
  for (const obj of visible) {
    const [x,y] = chartPoint(obj.alt,obj.az);
    const color = isISS(obj.name) ? "#ffc27b" : "#a4ddbf";
    const group = svg(map,"g",{cursor:"pointer"});
    svg(group,"title",{},obj.name+" · altitude "+degrees(obj.alt)+" · azimuth "+degrees(obj.az));
    svg(group,"circle",{cx:x,cy:y,r:10, fill:color,opacity:.11});
    svg(group,"circle",{cx:x,cy:y,r:obj.name===selected?5:3.8,fill:color});
    if (obj.name===selected) svg(group,"circle",{cx:x,cy:y,r:10,fill:"none",stroke:color});
    const labelY = [y-12,y+19,y-27,y+34].find(candidate => seenLabels.every(p => Math.abs(p[0]-x)>54 || Math.abs(p[1]-candidate)>14));
    if (labelY !== undefined) {
      seenLabels.push([x,labelY]);
      svg(group,"text",{x,y:labelY,fill:color,"font-size":13,"text-anchor":"middle","paint-order":"stroke",stroke:"#152a31","stroke-width":3},obj.name);
    }
    group.onclick=() => choose(obj.name);
  }
}
function choose(name) {
  selected = name;
  renderPositions();
}
function renderPositions() {
  renderChart();
  const list = $("object-list");
  const focusedName = list.contains(document.activeElement) ? document.activeElement.dataset.object : null;
  list.replaceChildren();
  for (const obj of positions) {
    const row = element("button",null,"obj"+(obj.alt<0?" down":""));
    row.dataset.object = obj.name;
    row.setAttribute("aria-pressed",String(selected===obj.name)); row.onclick=()=>choose(obj.name);
    row.append(element("span",obj.name),element("span",degrees(obj.alt)),element("span",degrees(obj.az))); list.append(row);
    if (obj.name === focusedName) row.focus({preventScroll:true});
  }
  const obj = positions.find(p=>p.name===selected);
  $("focus").textContent = obj ? obj.name + " is " + degrees(Math.abs(obj.alt)) + (obj.alt < 0 ? " below" : " above") + " the horizon, toward " + ["N","NE","E","SE","S","SW","W","NW"][Math.round(obj.az/45)%8] + "." : "Select a body to inspect its position.";
}

function action(label, fn) {
  const b = element("button",label); b.type="button"; b.onclick=fn; return b;
}
function showReplayControl() {
  const controls = $("sample-actions");
  controls.hidden = false;
  controls.replaceChildren();
  if (previousObservation) {
    controls.append(element("p", "Replaying a predicted solar transit on April 25, 2024."));
    controls.append(action("Restore my observation", () => {
      const saved = previousObservation;
      previousObservation = null;
      site = saved.site;
      instant = saved.live ? new Date() : saved.instant;
      live = saved.live;
      $("hours").value = saved.hours;
      track = [];
      syncSite(); syncClock(); loadView();
    }));
  } else {
    controls.append(action("Replay a historical solar transit", () => {
      previousObservation = { site, instant, live, hours: $("hours").value };
      site = { lat: 48.98489, lon: -93.13602, elevation: 0, name: "Replay site · 48.985° N, 93.136° W" };
      instant = new Date("2024-04-25T13:45:00Z");
      live = false;
      track = [];
      $("hours").value = "6";
      syncSite(); syncClock(); loadView();
    }));
  }
}
function row(parent,title,detail,button) {
  const container=element("div",null,"event-row"), description=element("div");
  description.append(element("strong",title),element("small",detail));
  container.append(description);
  if(button) container.append(button);
  parent.append(container);
}
async function showCorridor(event) {
  const revision = ++corridorGeneration;
  const panel=$("corridor-panel"), area=$("corridor");
  panel.hidden=false; area.textContent="Calculating the ground track…"; panel.scrollIntoView({block:"start"});
  try {
    const {points}=await api("corridor",{...parameters(new Date(event.peak)),target:event.target});
    if(revision!==corridorGeneration) return;
    area.replaceChildren();
    if(!points.length) {area.textContent="No ground track could be calculated for this event.";return;}
    area.append(element("p",event.target+" · "+shortUTC(event.peak)+" · estimated viewing corridor"));
    const ref=points[Math.floor(points.length/2)];
    const project=(lat,lon)=>[((lon-ref.lon+540)%360-180)*111.32*Math.cos(ref.lat*Math.PI/180),(ref.lat-lat)*111.32];
    const center=points.map(p=>project(p.lat,p.lon)), left=points.map(p=>project(p.left_lat,p.left_lon)), right=points.map(p=>project(p.right_lat,p.right_lon)), observer=project(site.lat,site.lon);
    const all=[...center,...left,...right,observer];
    const xMin=Math.min(...all.map(p=>p[0])), xMax=Math.max(...all.map(p=>p[0]));
    const yMin=Math.min(...all.map(p=>p[1])), yMax=Math.max(...all.map(p=>p[1]));
    const scale=Math.min(550/Math.max(1,xMax-xMin),235/Math.max(1,yMax-yMin));
    const pixel=([x,y])=>[320+(x-(xMin+xMax)/2)*scale,150+(y-(yMin+yMax)/2)*scale];
    const map=document.createElementNS(svgNS,"svg"); map.setAttribute("viewBox","0 0 640 300"); map.setAttribute("aria-label","Transit corridor and observer in a local north-up coordinate grid"); map.setAttribute("role","img"); area.append(map);
    for(let i=40;i<640;i+=40) svg(map,"line",{x1:i,x2:i,y1:0,y2:300,stroke:"#243c43"});
    for(let i=30;i<300;i+=40) svg(map,"line",{x1:0,x2:640,y1:i,y2:i,stroke:"#243c43"});
    svg(map,"polygon",{points:[...left,...right.reverse()].map(pixel).join(" "),fill:"#a4ddbf",opacity:.35});
    svg(map,"polyline",{points:center.map(pixel).join(" "),fill:"none",stroke:"#a4ddbf","stroke-width":2});
    const [x,y]=pixel(observer); svg(map,"circle",{cx:x,cy:y,r:5,fill:"#ffc27b"});
    svg(map,"text",{x:Math.min(x+9,540),y:y-8,fill:"#ffc27b","font-size":13},"Observer");
    const scaleKm = Math.pow(10,Math.floor(Math.log10(100/scale)));
    svg(map,"line",{x1:14,x2:14+scaleKm*scale,y1:282,y2:282,stroke:"#cbd8d8","stroke-width":2});
    svg(map,"text",{x:14,y:276,fill:"#cbd8d8","font-size":12},scaleKm+" km");
    function distanceToSite(point) {
      const [pointX, pointY] = project(point.lat, point.lon);
      return Math.hypot(pointX - observer[0], pointY - observer[1]);
    }
    const closest = points.reduce((best, point) => distanceToSite(point) < distanceToSite(best) ? point : best);
    area.append(element("p","Nearest sampled centerline point · "+closest.lat.toFixed(5)+"°, "+closest.lon.toFixed(5)+"°","coord"));
    const maps=element("a","Open this point on OpenStreetMap");maps.href="https://www.openstreetmap.org/?mlat="+closest.lat+"&mlon="+closest.lon+"#map=13/"+closest.lat+"/"+closest.lon; maps.target="_blank"; maps.rel="noopener noreferrer";area.append(maps);
    const reuse = element("div", null, "corridor-actions");
    reuse.append(action("Search from this centerline point", () => {
      instant = new Date(Date.parse(closest.time) - 300000);
      live = false;
      syncClock();
      applySite(closest.lat, closest.lon, 0);
    }));
    area.append(reuse);
  } catch(err) { if(revision===corridorGeneration) area.textContent=err.message; }
}
function renderEvents(data) {
  const definitions=[["transits",data.transits,"No disk crossings at this site in the covered interval."],["near-misses",data.near_misses,"No near misses in the covered interval."],["passes",data.passes,"No passes in the covered interval."]];
  for(const [id,records,empty] of definitions) {
    const parent=$(id); parent.replaceChildren();
    if(!records?.length) parent.textContent=data.gaps?.length ? "No results from the available orbits." : empty;
    for(const ev of records||[]) {
      if(id==="passes") {
        row(parent,shortUTC(ev.peak),"Rise "+shortUTC(ev.rise)+" · Set "+shortUTC(ev.set)+" · Peak altitude "+degrees(ev.peak_alt),
          action("View track",()=>{instant=new Date(ev.peak); live=false;track=ev.track||[];selected="ISS";syncClock();location.hash="sky";}));
      } else {
        const description=id==="transits" ? "Entry "+preciseUTC(ev.entry)+" · Exit "+preciseUTC(ev.exit)+" · Duration "+ev.duration_s.toFixed(2)+" s" : "Closest separation "+degrees(ev.separation_deg);
        const localTime = new Date(ev.peak).toLocaleTimeString(undefined,{timeZoneName:"short"});
        const age = ev.orbit ? " · Orbit epoch "+shortUTC(ev.orbit.epoch)+" ("+(Math.abs(Date.parse(ev.peak)-Date.parse(ev.orbit.epoch))/3600000).toFixed(1)+" h from event)" : "";
        const controls = element("div", null, "event-actions");
        controls.append(action("View sky", () => {
          instant = new Date(ev.peak);
          live = false;
          const pass = data.passes.find(p => Date.parse(p.rise) <= +instant && +instant <= Date.parse(p.set));
          track = pass?.track || [];
          selected = "ISS";
          syncClock();
          location.hash = "sky";
        }), action("View corridor", () => showCorridor(ev)));
        row(parent,ev.target+" · "+preciseUTC(ev.peak),description+" · "+localTime+" device time · Alt "+degrees(ev.alt)+" · Az "+degrees(ev.az)+age, controls);
      }
    }
  }
  const summary=$("event-summary");
  summary.replaceChildren(element("span","From "+shortUTC(instant)+" · "+$("hours").value+" hours"));
  if(data.gaps?.length) {
    const gaps=element("details");gaps.append(element("summary","Orbit coverage gaps ("+data.gaps.length+")"));
    for(const gap of data.gaps) gaps.append(element("p",shortUTC(gap.start)+" to "+shortUTC(gap.end)));
    summary.append(gaps, action("Get historical orbits",()=>{location.hash="archive";}));
  }
}
async function loadView() {
  const revision=++generation, view=activeView();
  ++corridorGeneration; $("corridor-panel").hidden=true;
  for(const id of Object.keys(titles)) $(id).hidden=id!==view;
  for(const link of document.querySelectorAll("nav a")) {
    if(link.hash==="#"+view) link.setAttribute("aria-current","page"); else link.removeAttribute("aria-current");
  }
  $("view-title").textContent=titles[view];$("notice").textContent="";
  if(view==="sky") {
    pendingSky = true;
    $("chart-date").textContent=stamp(instant).slice(0,10);
    if(!live || !positions.length) {positions=[]; renderPositions();}
    $("sky-orbit").textContent="Calculating positions…";
  } else if(view==="events") {
    showReplayControl();
    $("event-summary").textContent="Searching the selected interval…";
    for(const id of ["passes","transits","near-misses"]) $(id).replaceChildren();
  } else { $("orbits").textContent="Reading saved orbits…"; }
  try {
    if(view==="sky") {
      const data=await api("sky",parameters()); if(revision!==generation) return;
      positions=data.positions;
      if(!positions.some(obj=>obj.name===selected)) selected=(positions.find(obj=>isISS(obj.name))||positions.find(obj=>obj.alt>=0)||positions[0])?.name;
      renderPositions(); $("sky-orbit").textContent=data.orbit?"ISS orbit epoch · "+shortUTC(data.orbit.epoch)+" · "+data.orbit.source:"ISS orbit unavailable for this time. Import or retrieve a dated orbit in the archive.";
    } else if(view==="events") {
      const data=await api("events",{...parameters(),hours:$("hours").value});if(revision===generation) renderEvents(data);
    } else {
      const data=await api("archive");if(revision!==generation) return;
      const parent=$("orbits");parent.replaceChildren();
      if(!data.orbits.length) parent.textContent="No ISS orbits saved yet. Fetch the latest orbit or import a historical set.";
      for(const orbit of data.orbits) row(parent,shortUTC(orbit.epoch),orbit.source,action("View sky",()=>{instant=new Date(orbit.epoch);live=false;track=[];syncClock();location.hash="sky";}));
    }
  } catch(err) {
    if(revision!==generation) return;
    $("notice").replaceChildren(element("span",err.message+" "),action("Retry",loadView));
    if(view==="sky") {positions=[];renderPositions();$("sky-orbit").textContent="Sky positions unavailable.";}
    else $(view==="events"?"event-summary":"orbits").textContent="Data unavailable.";
  } finally {
    if(view === "sky" && revision === generation) pendingSky = false;
  }
}
async function archiveAction(button,path,payload) {
  button.disabled=true;$("notice").textContent="Loading orbit data…";
  try {
    const data=await api(path,null,payload);
    if(path==="import") $("tle").value="";
    if(activeView()==="archive") {
      await loadView();
      if(!$("notice").textContent) $("notice").textContent = data.count === 0 ? "No new orbit records were added for this request." : "Orbit archive updated.";
    }
  } catch(err) { $("notice").textContent=err.message; }
  finally { button.disabled=false; }
}
$("refresh").onclick=()=>archiveAction($("refresh"),"refresh",{});
$("import-form").onsubmit=e=>{e.preventDefault();archiveAction(e.submitter||$("import-form").querySelector("button"),"import",{tle:$("tle").value.trim()});};
$("history").onclick=()=>archiveAction($("history"),"history",{start:instant.toISOString(),end:new Date(+instant+Number($("hours").value)*3600000).toISOString()});
$("hours").onchange=loadView;
window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  loadView();
});
syncSite();syncClock();loadView();
if (window.browserApi) {
  $("refresh").hidden = true;
  $("history").hidden = true;
  $("history").parentElement.querySelector("p").textContent =
    "This hosted version refreshes the current ISS orbit during its daily build. For other dates, paste an ISS TLE below. Saved elements stay in this browser.";
}
setInterval(()=>{
  if(live && !pendingSky && activeView()==="sky" && !document.hidden && document.activeElement!==$("when") && document.activeElement!==$("scrub")) {
    instant=new Date();syncClock();loadView();
  }
},10000);
