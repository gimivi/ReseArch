// ui/modal_research_images.js
(function(){
  "use strict";

  const API = "ui/modal_research_images_tools.php";
  const MAX_MB = 5;
  const MAX_BYTES = MAX_MB * 1024 * 1024;

  const modalEl = document.getElementById("modalResearchImages");
  if(!modalEl) return;

  const msgEl = document.getElementById("imgMsg");

  function setMsg(type, text){
    msgEl.classList.remove("d-none","alert-success","alert-danger","alert-warning","alert-info");
    msgEl.classList.add("alert-" + (type || "info"));
    msgEl.textContent = text || "";
  }
  function clearMsg(){ msgEl.classList.add("d-none"); msgEl.textContent=""; }

  function getSelectedResearch(){
    return window.currentResearch || null;
  }

  async function apiGetSelected(res_id){
    const r = await fetch(`${API}?action=get&res_id=${encodeURIComponent(res_id)}`, {credentials:"same-origin"});
    const j = await r.json().catch(()=>null);
    if(!r.ok || !j) throw new Error((j && j.error) || t("errors.server_status", {status: r.status}));
    if(!j.success) throw new Error(j.error || t("errors.generic"));
    return j.data;
  }

  async function apiUpload(res_id, detBlob, icoBlob, logoRBlob, logoPBlob, resColor){
    const fd = new FormData();
    fd.append("res_id", String(res_id));
    if(detBlob)   fd.append("det",    detBlob,   "research_det.jpg");
    if(icoBlob)   fd.append("ico",    icoBlob,   "research_ico.jpg");
    if(logoRBlob) fd.append("logo_r", logoRBlob, "logo_ricerca.png");
    if(logoPBlob) fd.append("logo_p", logoPBlob, "logo_partner.png");
    if(resColor)  fd.append("res_color", resColor);

    const r = await fetch(`${API}?action=save`, {method:"POST", body:fd, credentials:"same-origin"});
    const j = await r.json().catch(()=>null);
    if(!r.ok || !j) throw new Error((j && j.error) || t("errors.server_status", {status: r.status}));
    if(!j.success) throw new Error(j.error || t("modal.research_images.save_failed"));
    return j.data;
  }

  // ----- CropperCanvas (zoom/pan + touch) -----
  class CropperCanvas{
    constructor({canvas, dropzone, hintEl, outW, outH, outFormat}){
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", {alpha:false});
      this.dropzone = dropzone;
      this.hintEl = hintEl;
      this.outW = outW;
      this.outH = outH;
      this.outFormat = outFormat || "image/jpeg";

      this.img = null;
      this.zoom = 1;      // relative to cover scale
      this.offsetX = 0;   // in CSS px
      this.offsetY = 0;

      this._dirty = false;
      this._drag = {on:false, x:0, y:0, ox:0, oy:0};

      // touch state
      this._touch = {
        active:false,
        mode:null, // "pan"|"pinch"
        startX:0, startY:0,
        startOx:0, startOy:0,
        startZoom:1,
        startDist:0,
        midX:0, midY:0
      };

      this._bind();
      this.resizeToClient();
      this.render();
    }

    resizeToClient(){
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.ctx.setTransform(1,0,0,1,0,0);
      this.ctx.scale(dpr, dpr); // draw in CSS px
      this.render();
    }

    setImage(img){
      this.img = img;
      this.resetView();
      this.hintEl.style.display = "none";
      this.render();
    }

    resetView(){
      this.zoom = 1;
      this.offsetX = 0;
      this.offsetY = 0;
    }

    clear(){
      this.img = null;
      this._dirty = false;
      this.resetView();
      this.hintEl.style.display = "";
      this.render();
    }

    hasImage(){ return !!this.img; }
    markDirty(){ this._dirty = true; }
    isModified(){ return this._dirty; }

    _coverScale(){
      if(!this.img) return 1;
      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;
      const sx = cw / this.img.naturalWidth;
      const sy = ch / this.img.naturalHeight;
      return Math.max(sx, sy);
    }

    _totalScale(){
      return this._coverScale() * this.zoom;
    }

    _clampOffsets(){
      if(!this.img) return;
      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;

      const s = this._totalScale();
      const iw = this.img.naturalWidth * s;
      const ih = this.img.naturalHeight * s;

      // più grande della cornice: si sposta senza scoprire i bordi; più piccola (logo rimpicciolito):
      // si sposta dentro la cornice senza uscirne (prima restava bloccata al centro)
      const maxX = Math.abs(iw - cw)/2;
      const maxY = Math.abs(ih - ch)/2;
      this.offsetX = Math.max(-maxX, Math.min(maxX, this.offsetX));
      this.offsetY = Math.max(-maxY, Math.min(maxY, this.offsetY));
    }

    render(){
      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;

      this.ctx.clearRect(0,0,cw,ch);
      this.ctx.fillStyle = "#f2f2f2";
      this.ctx.fillRect(0,0,cw,ch);

      if(!this.img){
        this.hintEl.style.display = "";
        this.ctx.strokeStyle = "#e7e7e7";
        for(let x=0; x<cw; x+=40){ this.ctx.beginPath(); this.ctx.moveTo(x,0); this.ctx.lineTo(x,ch); this.ctx.stroke(); }
        for(let y=0; y<ch; y+=40){ this.ctx.beginPath(); this.ctx.moveTo(0,y); this.ctx.lineTo(cw,y); this.ctx.stroke(); }
        return;
      }

      this._clampOffsets();

      const s = this._totalScale();
      const iw = this.img.naturalWidth * s;
      const ih = this.img.naturalHeight * s;

      const x = (cw - iw)/2 + this.offsetX;
      const y = (ch - ih)/2 + this.offsetY;

      this.ctx.imageSmoothingEnabled = true;
      this.ctx.drawImage(this.img, x, y, iw, ih);

      this.ctx.strokeStyle = "rgba(0,0,0,0.35)";
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(1,1,cw-2,ch-2);
    }

    async exportBlob(){
      if(!this.img) return {blob:null, warnLowRes:false, lowResInfo:""};

      const out = document.createElement("canvas");
      out.width = this.outW;
      out.height = this.outH;
      const isPng = this.outFormat === "image/png";
      const octx = out.getContext("2d", {alpha: isPng});
      if(!isPng){
        octx.fillStyle = "#fff";
        octx.fillRect(0,0,this.outW,this.outH);
      }

      const cw = this.canvas.getBoundingClientRect().width;
      const ch = this.canvas.getBoundingClientRect().height;
      const s = this._totalScale();

      const iwDraw = this.img.naturalWidth * s;
      const ihDraw = this.img.naturalHeight * s;
      const xDraw = (cw - iwDraw)/2 + this.offsetX;
      const yDraw = (ch - ihDraw)/2 + this.offsetY;

      const srcX = (0 - xDraw) / s;
      const srcY = (0 - yDraw) / s;
      const srcW = cw / s;
      const srcH = ch / s;

      const cropPixels = srcW * srcH;
      const destPixels = this.outW * this.outH;
      const warnLowRes = cropPixels < (destPixels / 4);
      const lowResInfo = t("modal.research_images.low_res_info", {w: Math.round(srcW), h: Math.round(srcH), out_w: this.outW, out_h: this.outH});

      octx.imageSmoothingEnabled = true;
      octx.drawImage(this.img, srcX, srcY, srcW, srcH, 0, 0, this.outW, this.outH);

      const quality = this.outFormat === "image/jpeg" ? 0.9 : undefined;
      const blob = await new Promise(resolve => out.toBlob(resolve, this.outFormat, quality));
      return {blob, warnLowRes, lowResInfo};
    }

    _bind(){
      // mouse pan
      this.dropzone.addEventListener("mousedown", (e)=>{
        if(!this.img) return;
        e.preventDefault();
        this._drag.on = true;
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
        this._drag.ox = this.offsetX;
        this._drag.oy = this.offsetY;
      });
      window.addEventListener("mousemove", (e)=>{
        if(!this._drag.on) return;
        this.offsetX = this._drag.ox + (e.clientX - this._drag.x);
        this.offsetY = this._drag.oy + (e.clientY - this._drag.y);
        this.render();
      });
      window.addEventListener("mouseup", ()=>{ this._drag.on = false; });

      // mouse wheel zoom
      this.dropzone.addEventListener("wheel", (e)=>{
        if(!this.img) return;
        e.preventDefault();
        const delta = Math.sign(e.deltaY);
        const factor = (delta > 0) ? 0.9 : 1.1;
        this.zoom = Math.max(0.2, Math.min(8, this.zoom * factor));
        this.render();
      }, {passive:false});

      // dblclick reset
      this.dropzone.addEventListener("dblclick", ()=>{
        if(!this.img) return;
        this.resetView();
        this.render();
      });

      // touch support
      this.dropzone.addEventListener("touchstart", (e)=>{
        if(!this.img) return;
        if(e.touches.length === 1){
          const tp = e.touches[0];
          this._touch.active = true;
          this._touch.mode = "pan";
          this._touch.startX = tp.clientX;
          this._touch.startY = tp.clientY;
          this._touch.startOx = this.offsetX;
          this._touch.startOy = this.offsetY;
        } else if(e.touches.length === 2){
          const t1 = e.touches[0], t2 = e.touches[1];
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          this._touch.active = true;
          this._touch.mode = "pinch";
          this._touch.startDist = Math.hypot(dx,dy);
          this._touch.startZoom = this.zoom;
          this._touch.startOx = this.offsetX;
          this._touch.startOy = this.offsetY;
        }
      }, {passive:true});

      this.dropzone.addEventListener("touchmove", (e)=>{
        if(!this._touch.active || !this.img) return;
        if(this._touch.mode === "pan" && e.touches.length === 1){
          const tp = e.touches[0];
          this.offsetX = this._touch.startOx + (tp.clientX - this._touch.startX);
          this.offsetY = this._touch.startOy + (tp.clientY - this._touch.startY);
          this.render();
        } else if(this._touch.mode === "pinch" && e.touches.length === 2){
          const t1 = e.touches[0], t2 = e.touches[1];
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          const dist = Math.hypot(dx,dy);
          const ratio = dist / (this._touch.startDist || dist);
          this.zoom = Math.max(0.2, Math.min(8, this._touch.startZoom * ratio));
          this.render();
        }
      }, {passive:true});

      this.dropzone.addEventListener("touchend", ()=>{
        this._touch.active = false;
        this._touch.mode = null;
      }, {passive:true});

      // resize
      const ro = new ResizeObserver(()=>this.resizeToClient());
      ro.observe(this.dropzone);
      window.addEventListener("resize", ()=>this.resizeToClient());
    }
  }

  function loadImageFromFile(file){
    return new Promise((resolve, reject)=>{
      if(file.size > MAX_BYTES){
        reject(new Error(t("modal.research_images.err.file_too_large", {mb: MAX_MB})));
        return;
      }
      const fr = new FileReader();
      fr.onload = ()=>{
        const img = new Image();
        img.onload = ()=>resolve(img);
        img.onerror = ()=>reject(new Error(t("modal.research_images.err.invalid_image")));
        img.src = fr.result;
      };
      fr.onerror = ()=>reject(new Error(t("modal.research_images.err.read_file")));
      fr.readAsDataURL(file);
    });
  }

  function hookDropzone(dz, fileInput, onImage){
    dz.addEventListener("dragover", (e)=>{ e.preventDefault(); dz.classList.add("dragover"); });
    dz.addEventListener("dragleave", ()=>dz.classList.remove("dragover"));
    dz.addEventListener("drop", async (e)=>{
      e.preventDefault();
      dz.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if(!file) return;
      try{
        const img = await loadImageFromFile(file);
        onImage(img);
      }catch(err){ alert(err.message); }
    });

    fileInput.addEventListener("change", async ()=>{
      const file = fileInput.files?.[0];
      if(!file) return;
      try{
        const img = await loadImageFromFile(file);
        onImage(img);
      }catch(err){ alert(err.message); }
      fileInput.value = "";
    });
  }

  const det = new CropperCanvas({
    canvas: document.getElementById("cvDet"),
    dropzone: document.getElementById("dzDet"),
    hintEl: document.getElementById("hintDet"),
    outW:1200, outH:400
  });

  const ico = new CropperCanvas({
    canvas: document.getElementById("cvIco"),
    dropzone: document.getElementById("dzIco"),
    hintEl: document.getElementById("hintIco"),
    outW:400, outH:400
  });

  const logoR = new CropperCanvas({
    canvas: document.getElementById("cvLogoR"),
    dropzone: document.getElementById("dzLogoR"),
    hintEl: document.getElementById("hintLogoR"),
    outW:240, outH:60, outFormat:"image/png"
  });

  const logoP = new CropperCanvas({
    canvas: document.getElementById("cvLogoP"),
    dropzone: document.getElementById("dzLogoP"),
    hintEl: document.getElementById("hintLogoP"),
    outW:240, outH:60, outFormat:"image/png"
  });

  document.getElementById("btnSelectDet").addEventListener("click", ()=>document.getElementById("fileDet").click());
  document.getElementById("btnSelectIco").addEventListener("click", ()=>document.getElementById("fileIco").click());
  document.getElementById("btnSelectLogoR").addEventListener("click", ()=>document.getElementById("fileLogoR").click());
  document.getElementById("btnSelectLogoP").addEventListener("click", ()=>document.getElementById("fileLogoP").click());
  document.getElementById("btnResetDet").addEventListener("click", ()=>{ det.resetView(); det.render(); });
  document.getElementById("btnResetIco").addEventListener("click", ()=>{ ico.resetView(); ico.render(); });
  document.getElementById("btnResetLogoR").addEventListener("click", ()=>{ logoR.resetView(); logoR.render(); });
  document.getElementById("btnResetLogoP").addEventListener("click", ()=>{ logoP.resetView(); logoP.render(); });

  hookDropzone(document.getElementById("dzDet"),   document.getElementById("fileDet"),   (img)=>{ det.setImage(img);   det.markDirty(); });
  hookDropzone(document.getElementById("dzIco"),   document.getElementById("fileIco"),   (img)=>{ ico.setImage(img);   ico.markDirty(); });
  hookDropzone(document.getElementById("dzLogoR"), document.getElementById("fileLogoR"), (img)=>{ logoR.setImage(img); logoR.markDirty(); });
  hookDropzone(document.getElementById("dzLogoP"), document.getElementById("fileLogoP"), (img)=>{ logoP.setImage(img); logoP.markDirty(); });

  // ----- Colore ricerca (res_color) -----
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const resColorPicker = document.getElementById("resColorPicker");
  const resColorHex    = document.getElementById("resColorHex");
  let loadedColor = "#555555";
  let colorDirty  = false;

  function setColor(hex){
    const v = HEX_RE.test(hex || "") ? hex : "#555555";
    resColorPicker.value = v;
    resColorHex.value    = v;
  }
  function isColorModified(){
    return colorDirty && HEX_RE.test(resColorHex.value) && resColorHex.value.toLowerCase() !== loadedColor.toLowerCase();
  }

  // <input type="color"> restituisce sempre un hex valido: sincronizza il campo testo.
  resColorPicker.addEventListener("input", ()=>{
    resColorHex.value = resColorPicker.value;
    colorDirty = true;
  });
  // Il campo testo è editabile a mano: aggiorna il picker solo se il valore è un hex valido.
  resColorHex.addEventListener("input", ()=>{
    colorDirty = true;
    if(HEX_RE.test(resColorHex.value)) resColorPicker.value = resColorHex.value;
  });

  async function loadExistingForSelected(){
    clearMsg();
    const sel = getSelectedResearch();
    if(!sel || !sel.res_id){
      setMsg("warning", t("modal.research_images.no_research.@"));
      return;
    }
    try{
      const data = await apiGetSelected(sel.res_id);
      function loadInto(cropper, url){
        if(!url){ cropper.img = null; cropper.render(); return; }
        const img = new Image();
        img.onload  = ()=>cropper.setImage(img);
        img.onerror = ()=>{ cropper.img = null; cropper.render(); };
        img.src = url;
      }
      loadInto(det,   data?.detUrl   ?? null);
      loadInto(ico,   data?.icoUrl   ?? null);
      loadInto(logoR, data?.logoRUrl ?? null);
      loadInto(logoP, data?.logoPUrl ?? null);

      loadedColor = HEX_RE.test(data?.resColor || "") ? data.resColor : "#555555";
      setColor(loadedColor);
      colorDirty = false;
    }catch(e){
      setMsg("warning", t("modal.research_images.err.load", {error: e.message}));
    }
  }

  document.getElementById("btnSaveResearchImages").addEventListener("click", async ()=>{
    clearMsg();
    const sel = getSelectedResearch();
    if(!sel || !sel.res_id){
      setMsg("warning", t("modal.research_images.no_research.@"));
      return;
    }

    if(colorDirty && !HEX_RE.test(resColorHex.value)){
      setMsg("warning", t("modal.research_images.err.color_invalid"));
      return;
    }

    if(!det.isModified() && !ico.isModified() && !logoR.isModified() && !logoP.isModified() && !isColorModified()){
      setMsg("warning", t("modal.research_images.nothing_to_save"));
      return;
    }

    try{
      const detExp   = det.isModified()   ? await det.exportBlob()   : {blob:null,warnLowRes:false,lowResInfo:""};
      const icoExp   = ico.isModified()   ? await ico.exportBlob()   : {blob:null,warnLowRes:false,lowResInfo:""};
      const logoRExp = logoR.isModified() ? await logoR.exportBlob() : {blob:null,warnLowRes:false,lowResInfo:""};
      const logoPExp = logoP.isModified() ? await logoP.exportBlob() : {blob:null,warnLowRes:false,lowResInfo:""};

      const warns = [{e:detExp,l:"DET"},{e:icoExp,l:"ICO"},{e:logoRExp,l:"LOGO_R"},{e:logoPExp,l:"LOGO_P"}];
      if(warns.some(w=>w.e.warnLowRes)){
        const parts = warns.filter(w=>w.e.warnLowRes).map(w=>w.l+": "+w.e.lowResInfo);
        const ok = confirm(t("modal.research_images.confirm_low_res", {details: parts.join("\n")}));
        if(!ok) return;
      }

      setMsg("info", t("common.saving"));
      const colorToSave = isColorModified() ? resColorHex.value : null;
      await apiUpload(sel.res_id, detExp.blob, icoExp.blob, logoRExp.blob, logoPExp.blob, colorToSave);
      setMsg("success", t("common.saved"));
      await loadExistingForSelected();
    }catch(e){
      setMsg("danger", e.message);
    }
  });

  modalEl.addEventListener("shown.bs.modal", ()=>{
    det.resizeToClient(); ico.resizeToClient();
    logoR.resizeToClient(); logoP.resizeToClient();
    loadExistingForSelected();
  });

  modalEl.addEventListener("hidden.bs.modal", ()=>{
    clearMsg();
    det.clear(); ico.clear();
    logoR.clear(); logoP.clear();
  });

})();
