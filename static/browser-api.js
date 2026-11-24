import * as satellite from "satellite.js";
import * as astronomy from "astronomy-engine";

const names = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
const builtIn = [
  ["2024", "ISS (ZARYA)\n1 25544U 98067A   24116.76570894  .00062894  00000+0  10654-2 0  9996\n2 25544  51.6396 215.3361 0004566  95.7745   7.6568 15.50926567450413"],
  ["2021", "ISS (ZARYA)\n1 25544U 98067A   21176.55543682 -.00003415  00000-0 -54431-4 0  9991\n2 25544  51.6457 301.3375 0002062  98.4178   3.0356 15.48721305289898"]
];
const key = "meridian-orbits";
let records = [];
try { records = JSON.parse(localStorage.getItem(key)) || []; } catch {}

function save() { localStorage.setItem(key, JSON.stringify(records.map(({first, second, source}) => ({first, second, source})))); }
function ingest(text, source) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => /^[12] 25544/.test(line));
  if (!lines.length || lines.length % 2) throw Error("Provide complete ISS (25544) TLE pairs.");
  const incoming = [];
  for (let i = 0; i < lines.length; i += 2) {
    const [first, second] = lines.slice(i, i + 2);
    if (!first.startsWith("1 ") || !second.startsWith("2 ") || first.length !== 69 || second.length !== 69) throw Error("Invalid ISS TLE pair.");
    const satrec = satellite.twoline2satrec(first, second);
    if (satrec.error || !Number.isFinite(satrec.jdsatepoch)) throw Error("Invalid ISS orbital elements.");
    const epoch = new Date((satrec.jdsatepoch - 2440587.5) * 86400000).toISOString();
    incoming.push({first, second, source, epoch, satrec});
  }
  const fresh = incoming.filter(r => !records.some(old => old.epoch === r.epoch));
  records.push(...fresh);
  records.sort((a,b) => a.epoch.localeCompare(b.epoch));
  save();
  return fresh.length;
}
const saved = records;
records = [];
for (const [name, text] of builtIn) ingest(text, "Archived ISS orbit · " + name);
for (const r of saved) ingest(r.first + "\n" + r.second, r.source);
async function refreshCurrent() {
  const response=await fetch("https://api.wheretheiss.at/v1/satellites/25544/tles");
  if(!response.ok) throw Error("Current orbit download failed. Try again later.");
  const data=await response.json();
  if(String(data.id)!=="25544" || !data.line1 || !data.line2) throw Error("Current orbit response was incomplete.");
  const count=ingest(data.line1+"\n"+data.line2,"Where the ISS at?");
  localStorage.setItem("meridian-last-refresh",String(Date.now()));
  return count;
}
const currentReady=(async()=>{
  if(Date.now()-Number(localStorage.getItem("meridian-last-refresh"))>3*3600000) {
    try {await refreshCurrent(); return;} catch {}
  }
  try {
    const response=await fetch("./current.tle");
    if(response.ok) ingest(await response.text(),"CelesTrak GP · published fallback");
  } catch {}
})();

function orbitAt(date) {
  const time = +date;
  const best = records.reduce((a,b) => Math.abs(Date.parse(a.epoch)-time) < Math.abs(Date.parse(b.epoch)-time) ? a : b);
  return Math.abs(Date.parse(best.epoch)-time) <= 3*86400000 ? best : null;
}
const metadata = orbit => orbit && ({epoch: orbit.epoch, source: orbit.source});
function body(name, date, lat, lon, elevation) {
  const observer = new astronomy.Observer(lat, lon, elevation);
  const eq = astronomy.Equator(astronomy.Body[name], date, observer, true, true);
  const h = astronomy.Horizon(date, observer, eq.ra, eq.dec, null);
  return {name, alt: h.altitude, az: h.azimuth, distance_km: eq.dist * astronomy.KM_PER_AU};
}
function station(orbit, date, lat, lon, elevation) {
  const pv = satellite.propagate(orbit.satrec, date);
  if (!pv?.position) return null;
  const ecf = satellite.eciToEcf(pv.position, satellite.gstime(date));
  const look = satellite.ecfToLookAngles({
    latitude: satellite.degreesToRadians(lat), longitude: satellite.degreesToRadians(lon), height: elevation/1000
  }, ecf);
  return {name:"ISS", alt: satellite.radiansToDegrees(look.elevation), az: satellite.radiansToDegrees(look.azimuth), distance_km: look.rangeSat};
}
function separation(a,b) {
  const rad = Math.PI/180;
  return Math.acos(Math.max(-1,Math.min(1,Math.sin(a.alt*rad)*Math.sin(b.alt*rad)+Math.cos(a.alt*rad)*Math.cos(b.alt*rad)*Math.cos((a.az-b.az)*rad))))/rad;
}
function siteArgs(p) { return [Number(p.lat), Number(p.lon), Number(p.elevation)]; }
const radii = {Sun:695700,Moon:1737.4,Mercury:2439.4,Venus:6051.8,Mars:3389.5,Jupiter:69911,Saturn:58232,Uranus:25362,Neptune:24622};
function sample(orbit, date, site, target) {
  const iss = station(orbit,date,...site), object = body(target,date,...site);
  if (!iss) return null;
  const radius = Math.asin(radii[target]/object.distance_km)*180/Math.PI + Math.asin(.055/iss.distance_km)*180/Math.PI;
  return {iss, object, sep: separation(iss,object), margin: separation(iss,object)-radius};
}
function minTime(f, a, b) {
  for (let i=0;i<28;i++) {
    const x=a+(b-a)*.382, y=a+(b-a)*.618;
    if (f(x)<f(y)) b=y; else a=x;
  }
  return (a+b)/2;
}
function boundary(f, a, b) {
  const sign = f(a)>0;
  for (let i=0;i<25;i++) {
    const m=(a+b)/2;
    if ((f(m)>0)===sign) a=m; else b=m;
  }
  return (a+b)/2;
}
function events(p) {
  const start=Date.parse(p.at), end=start+Number(p.hours || 24)*3600000, site=siteArgs(p);
  const result={passes:[],transits:[],near_misses:[],gaps:[]};
  let gapStart=null, passStart=null, passPeak=null, passPeakAlt=-90;
  const step=10000, passes=[];
  for(let t=start;t<=end+step;t+=step) {
    const orbit=orbitAt(new Date(t)), position=orbit && station(orbit,new Date(t),...site);
    const above=position && position.alt>=0;
    if(!orbit && gapStart===null) gapStart=t;
    if(orbit && gapStart!==null) {result.gaps.push({start:new Date(gapStart).toISOString(),end:new Date(t).toISOString()});gapStart=null;}
    if(above && passStart===null) {passStart=t;passPeak=t;passPeakAlt=position.alt;}
    if(above && position.alt>passPeakAlt) {passPeak=t;passPeakAlt=position.alt;}
    if(!above && passStart!==null) {passes.push([passStart,Math.min(t,end),passPeak]);passStart=null;passPeakAlt=-90;}
  }
  if(gapStart!==null) result.gaps.push({start:new Date(gapStart).toISOString(),end:new Date(end).toISOString()});
  for(const [rise,set,coarsePeak] of passes) {
    const orbit=orbitAt(new Date(coarsePeak)), peak=minTime(t=>-station(orbit,new Date(t),...site).alt,Math.max(rise,coarsePeak-step),Math.min(set,coarsePeak+step));
    const top=station(orbit,new Date(peak),...site);
    const track=[];
    for(let t=rise;t<=set;t+=4000) {const s=station(orbit,new Date(t),...site);track.push({time:new Date(t).toISOString(),alt:s.alt,az:s.az});}
    result.passes.push({rise:new Date(rise).toISOString(),peak:new Date(peak).toISOString(),set:new Date(set).toISOString(),peak_alt:top.alt,peak_az:top.az,track});
    for(const target of (p.target && p.target!=="Sun and Moon" ? [p.target] : ["Sun","Moon"])) {
      let prev=Infinity, current=Infinity;
      const candidates=[];
      for(let t=rise;t<=set+2000;t+=2000) {
        const next=sample(orbit,new Date(Math.min(t,set)),site,target)?.sep ?? Infinity;
        if(current<=prev && current<=next && current<3.5) candidates.push(t-2000);
        prev=current;current=next;
      }
      for(const candidate of candidates) {
        const a=Math.max(rise,candidate-2000), b=Math.min(set,candidate+2000);
        const closest=minTime(t=>sample(orbit,new Date(t),site,target).sep,a,b);
        const hit=sample(orbit,new Date(closest),site,target);
        if(hit.sep>3 || hit.object.alt<0) continue;
        const row={target,peak:new Date(closest).toISOString(),alt:hit.object.alt,az:hit.object.az,separation_deg:hit.sep,orbit:metadata(orbit)};
        if(hit.margin<=0) {
          row.detail={iss_alt:hit.iss.alt,iss_az:hit.iss.az,
            iss_radius:Math.asin(.055/hit.iss.distance_km)*180/Math.PI,
            body_radius:Math.asin(radii[target]/hit.object.distance_km)*180/Math.PI};
          const f=t=>sample(orbit,new Date(t),site,target).margin;
          let entry=closest, exit=closest;
          while(entry>rise && f(entry)<=0) entry-=500;
          while(exit<set && f(exit)<=0) exit+=500;
          const first=boundary(f,entry,closest), last=boundary(f,closest,exit);
          Object.assign(row,{entry:new Date(first).toISOString(),exit:new Date(last).toISOString(),duration_s:(last-first)/1000});
          result.transits.push(row);
        } else result.near_misses.push(row);
      }
    }
  }
  return result;
}
function corridor(p) {
  const site=siteArgs(p), at=new Date(p.at), orbit=orbitAt(at), target=p.target;
  if(!orbit) throw Error("No ISS orbit near this time.");
  // Project the apparent target direction onto a local observer grid.
  const points=[];
  for(let dt=-30000;dt<=30000;dt+=1000) {
    const date=new Date(+at+dt), base=station(orbit,date,...site), object=body(target,date,...site);
    if(!base || object.alt<0) continue;
    const dlat=.001, dlon=.001;
    const angle=(lat,lon)=>{const a=station(orbit,date,lat,lon,0),b=body(target,date,lat,lon,0);return [a.alt-b.alt,((a.az-b.az+540)%360-180)*Math.cos(b.alt*Math.PI/180)];};
    let lat=site[0],lon=site[1];
    for(let i=0;i<5;i++) {
      const v=angle(lat,lon), a=angle(lat+dlat,lon), b=angle(lat,lon+dlon);
      const x=(a[0]-v[0])/dlat,y=(b[0]-v[0])/dlon,z=(a[1]-v[1])/dlat,w=(b[1]-v[1])/dlon, det=x*w-y*z;
      if(Math.abs(det)<1e-8) break;
      lat-=(w*v[0]-y*v[1])/det;lon-=(x*v[1]-z*v[0])/det;
    }
    if(Math.abs(lat)>90 || Math.abs(lon)>180) continue;
    const radius=target==="Sun"?695700:1737.4, angular=Math.asin(radius/object.distance_km)*180/Math.PI;
    const halfWidth=angular/(Math.hypot(...angle(lat+.01,lon).map(v=>v/.01))||1);
    points.push({time:date.toISOString(),lat,lon,left_lat:lat+halfWidth,left_lon:lon,right_lat:lat-halfWidth,right_lon:lon});
  }
  return {points,orbit:metadata(orbit)};
}
export async function browserApi(path,p={},payload={}) {
  await currentReady;
  if(path==="sky") {
    const date=new Date(p.at), site=siteArgs(p), orbit=orbitAt(date);
    return {positions:[...(orbit?[station(orbit,date,...site)]:[]),...names.map(n=>body(n,date,...site))].filter(Boolean),orbit:metadata(orbit)};
  }
  if(path==="path") {
    const start = new Date(p.at), site = siteArgs(p), orbit = orbitAt(start);
    if (p.target === "ISS" && !orbit) return [];
    const step = p.target === "ISS" ? 10000 : 300000;
    return Array.from({length:73}, (_, i) => {
      const time = new Date(+start + i * step);
      return p.target === "ISS" ? station(orbit,time,...site) : body(p.target,time,...site);
    });
  }
  if(path==="events") return events(p);
  if(path==="corridor") return corridor(p);
  if(path==="archive") return {orbits:records.map(metadata),count:records.length};
  if(path==="import") return {count:ingest(payload.tle,"Imported TLE")};
  if(path==="refresh") {
    return {count:await refreshCurrent()};
  }
  if(path==="history") throw Error("Historical downloads require the local app. Paste a dated ISS TLE into the archive.");
  throw Error("Unknown request.");
}
window.browserApi=browserApi;
