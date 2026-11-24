"use strict";

const pathColors = {
  ISS:"#ffc27b", Sun:"#f9db62", Moon:"#dae7ff", Mercury:"#bdb4ae", Venus:"#efb3cc",
  Mars:"#f38b79", Jupiter:"#dca580", Saturn:"#c9c982", Uranus:"#7dd3c7", Neptune:"#86aaf7"
};

function setupHorizon() {
  const canvas = $("panorama"), ctx = canvas.getContext("2d");
  const guide = $("sky-guide"), rad = Math.PI / 180;
  const compass = ["N","NE","E","SE","S","SW","W","NW"];
  let heading = 0, pitch = 22, drag;
  const paths = new Map(), requests = new Map(), controls = new Map();
  const stationShape = new Path2D($("station-icon").getAttribute("d"));
  let edited = false;
  for (const [name,color] of Object.entries(pathColors)) {
    const label = element("label"), input = element("input");
    input.type = "checkbox";
    label.style.setProperty("--path-color",color);
    label.append(input, name);
    $("path-options").append(label);
    controls.set(name,input);
    input.onchange = () => { edited = true; update(); };
  }
  const card = canvas.closest("article"), expand = $("expand-chart");
  function syncFullscreen() {
    const full = document.fullscreenElement === card || card.classList.contains("expanded");
    expand.textContent = full ? "Exit full screen" : "⛶ Full screen";
    expand.setAttribute("aria-pressed",String(full));
  }
  expand.onclick = async () => {
    if (document.fullscreenElement === card) await document.exitFullscreen();
    else if (card.classList.contains("expanded")) card.classList.remove("expanded");
    else {
      try { await card.requestFullscreen(); }
      catch { card.classList.add("expanded"); }
    }
    syncFullscreen();
  };
  document.addEventListener("fullscreenchange",syncFullscreen);
  document.addEventListener("keydown",e => {
    if (e.key === "Escape" && card.classList.contains("expanded")) expand.click();
  });
  function face() {
    const body = positions.find(p => p.name === selected);
    if (body) { heading = body.az; pitch = Math.max(5,body.alt); }
  }
  function draw() {
    if (canvas.hidden || !canvas.clientWidth || !canvas.clientHeight) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w*ratio) || canvas.height !== Math.round(h*ratio)) {
      canvas.width = Math.round(w*ratio); canvas.height = Math.round(h*ratio);
    }
    ctx.setTransform(ratio,0,0,ratio,0,0);
    const focal = Math.min(w,h)*0.85, tilt = pitch*rad;
    function project(alt,az) {
      const a = alt*rad, d = (az-heading)*rad;
      const forward = Math.cos(a)*Math.cos(d), up = Math.sin(a);
      const depth = forward*Math.cos(tilt) + up*Math.sin(tilt);
      if (depth <= 0.03) return null;
      return [w/2 + focal*Math.cos(a)*Math.sin(d)/depth,
              h/2 - focal*(up*Math.cos(tilt)-forward*Math.sin(tilt))/depth];
    }
    const horizonY = h/2 + focal*Math.tan(tilt);
    const sky = ctx.createLinearGradient(0,0,0,h);
    sky.addColorStop(0,"#0b1929"); sky.addColorStop(1,"#284951");
    ctx.fillStyle = sky; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = "#152724"; ctx.fillRect(0,horizonY,w,h);
    function line(points,color) {
      ctx.beginPath();
      let connected = false;
      for (const p of points) {
        const xy = p && p.alt >= 0 && project(p.alt,p.az);
        if (xy) { if (connected) ctx.lineTo(...xy); else ctx.moveTo(...xy); }
        connected = Boolean(xy);
      }
      ctx.strokeStyle = color; ctx.stroke();
    }
    for (let alt=0; alt<90; alt+=15)
      line(Array.from({length:121},(_,i)=>({alt,az:i*3})),alt ? "#35515d" : "#86b4aa");
    ctx.font = "12px monospace"; ctx.textAlign = "center";
    for (let az=0; az<360; az+=45) {
      line(Array.from({length:31},(_,i)=>({alt:i*3,az})),"#35515d");
      const xy = project(0,az);
      if (xy) { ctx.fillStyle = "#d1e3dc"; ctx.fillText(compass[az/45],xy[0],xy[1]+16); }
    }
    ctx.setLineDash([5,5]);
    for (const [name,path] of paths) line(path,pathColors[name]);
    ctx.setLineDash([]);
    ctx.textAlign = "left";
    for (const p of positions) {
      if (p.alt < 0) continue;
      const xy = project(p.alt,p.az);
      if (!xy) continue;
      const [x,y] = xy;
      ctx.fillStyle = isISS(p.name) ? "#ffc27b" : "#a4ddbf";
      if (isISS(p.name)) {
        ctx.save(); ctx.translate(x,y); ctx.rotate(-20*rad); ctx.fill(stationShape); ctx.restore();
      } else { ctx.beginPath(); ctx.arc(x,y,4,0,2*Math.PI); ctx.fill(); }
      if (p.name===selected) {
        ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.arc(x,y,8,0,2*Math.PI); ctx.stroke();
      }
      ctx.strokeStyle = "#152630"; ctx.lineWidth = 3; ctx.strokeText(p.name,x+11,y+4);
      ctx.lineWidth = 1; ctx.fillText(p.name,x+11,y+4);
    }
    const az = (heading%360+360)%360;
    document.querySelector(".chart-foot > span:last-child").textContent =
      compass[Math.round(az/45)%8]+" · "+Math.round(az)%360+"° az · "+Math.round(pitch)+"° alt";
    guide.textContent = "Drag or use arrow keys to look around.";
  }
  function paint() {
    if (canvas.hidden) renderChart(); else draw();
  }
  function update() {
    const station = positions.find(p=>isISS(p.name));
    $("station-status").textContent = station ? "ISS · "+degrees(Math.abs(station.alt))+
      (station.alt < 0 ? " below horizon" : " above horizon") :
      (positions.length ? "ISS · orbit unavailable" : "ISS · position unavailable");
    const params = parameters();
    for (const [name,input] of controls) {
      input.disabled = !positions.some(p=>p.name===name);
      if (!edited) input.checked = !canvas.hidden && name === selected;
      if (!input.checked || input.disabled) { requests.delete(name); paths.delete(name); continue; }
      const key = JSON.stringify(params);
      if (requests.get(name)?.key === key) continue;
      const request = {key,state:"loading"};
      requests.set(name,request);
      paths.delete(name);
      api("path",{...params,target:name}).then(points=>{
        if (requests.get(name)!==request) return;
        paths.set(name,points);
        request.state = "ready";
      }).catch(()=>{ request.state = "failed"; }).finally(()=>{
        if (requests.get(name)===request) { report(); paint(); }
      });
    }
    report(); paint();
  }
  function report() {
    const failed = [...requests].filter(([,r])=>r.state==="failed").map(([name])=>name);
    $("path-status").textContent = failed.length ? "Path unavailable for "+failed.join(", ") :
      [...requests.values()].some(r=>r.state==="loading") ? "Calculating paths…" : "";
  }
  function mode(depth) {
    canvas.hidden = guide.hidden = !depth;
    $("sky-map").toggleAttribute("hidden",depth);
    $("depth").setAttribute("aria-pressed",String(depth)); $("flat").setAttribute("aria-pressed",String(!depth));
    if (depth) { face(); canvas.focus(); }
    else document.querySelector(".chart-foot > span:last-child").textContent = "Looking up · east on left";
    update();
  }
  $("flat").onclick = ()=>mode(false); $("depth").onclick = ()=>mode(true);
  function pan(dx,dy) {
    heading = (heading+dx+360)%360; pitch = Math.max(0,Math.min(90,pitch+dy)); draw();
  }
  canvas.onkeydown = e => {
    const delta = {ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,5],ArrowDown:[0,-5]}[e.key];
    if (delta) { e.preventDefault(); pan(...delta); }
  };
  canvas.onpointerdown = e => {
    if (!e.isPrimary || e.button!==0) return;
    canvas.setPointerCapture(e.pointerId); drag = [e.clientX,e.clientY];
  };
  canvas.onpointermove = e => {
    if (!drag || !canvas.hasPointerCapture(e.pointerId)) return;
    const scale = 63/Math.min(canvas.clientWidth,canvas.clientHeight);
    pan((drag[0]-e.clientX)*scale,(e.clientY-drag[1])*scale); drag = [e.clientX,e.clientY];
  };
  canvas.onlostpointercapture = ()=>{ drag = null; };
  new ResizeObserver(draw).observe(canvas);
  return {face,update,paths};
}
