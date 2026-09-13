class FakeElement {
  constructor(tag){
    this.tagName = tag;
    this._attrs = {};
    this._text = "";
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.dataset = {};
  }
  get textContent(){ return this._text; }
  set textContent(v){ this._text = String(v); }
  get innerHTML(){ return this._text; }
  set innerHTML(v){ this.children = []; if(v === "") this._text = ""; }
  get value(){ return this._value === undefined ? "" : this._value; }
  set value(v){ this._value = v; }
  get className(){ return this._attrs["class"] || ""; }
  set className(v){ this._attrs["class"] = v; }
  get id(){ return this._attrs["id"] || ""; }
  set id(v){ this._attrs["id"] = v; }
  get classList(){
    const self = this;
    return {
      add(c){ const l = self.className.split(" ").filter(Boolean); if(!l.includes(c)){ l.push(c); self.className = l.join(" "); } },
      remove(c){ self.className = self.className.split(" ").filter(x => x && x!==c).join(" "); },
      toggle(c, force){ const has = self.classList.contains(c); const shouldHave = force===undefined ? !has : force; if(shouldHave) self.classList.add(c); else self.classList.remove(c); return shouldHave; },
      contains(c){ return self.className.split(" ").filter(Boolean).includes(c); }
    };
  }
  setAttribute(k,v){ this._attrs[k] = String(v); }
  getAttribute(k){ return this._attrs.hasOwnProperty(k) ? this._attrs[k] : null; }
  removeAttribute(k){ delete this._attrs[k]; }
  appendChild(c){ this.children.push(c); return c; }
  removeChild(c){ this.children = this.children.filter(x => x!==c); return c; }
  addEventListener(evt, fn){ (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
  removeEventListener(evt, fn){ if(this.listeners[evt]) this.listeners[evt] = this.listeners[evt].filter(f => f!==fn); }
  dispatch(evt, payload){ (this.listeners[evt] || []).forEach(fn => fn(payload || {currentTarget:this, target:this})); }
  click(){ this.dispatch("click", {currentTarget:this, target:this}); }
  _matches(sel){
    if(sel[0] === "."){ return this.classList.contains(sel.slice(1)); }
    if(sel[0] === "#"){ return this.id === sel.slice(1); }
    return false;
  }
  _findAll(sel, out){
    out = out || [];
    if(this._matches(sel)) out.push(this);
    this.children.forEach(c => c._findAll && c._findAll(sel, out));
    return out;
  }
  querySelectorAll(sel){ return this._findAll(sel, []); }
  querySelector(sel){ const all = this._findAll(sel, []); return all.length ? all[0] : null; }
  focus(){}
  select(){}
  get offsetWidth(){ return 100; }
}

function makeSandbox(opts){
  opts = opts || {};
  const localStore = {};
  const localStorageObj = {
    getItem(k){ return Object.prototype.hasOwnProperty.call(localStore, k) ? localStore[k] : null; },
    setItem(k, v){
      if(opts.localStorageThrows) throw new Error("simulated localStorage failure");
      localStore[k] = String(v);
    },
    removeItem(k){ delete localStore[k]; },
    _store: localStore
  };

  const documentElementNode = new FakeElement("html");
  const bodyNode = new FakeElement("body");
  const rootEl = new FakeElement("div");
  rootEl.setAttribute("id", "root");
  const documentObj = {
    createElement(tag){ return new FakeElement(tag); },
    createElementNS(ns, tag){ return new FakeElement(tag); },
    getElementById(id){
      if(id === "root") return rootEl;
      const found = rootEl._findAll("#" + id, []);
      return found.length ? found[0] : null;
    },
    addEventListener(){},
    body: bodyNode,
    documentElement: documentElementNode,
    _rootEl: rootEl
  };

  const listeners = {};
  const windowObj = {
    addEventListener(evt, fn){ (listeners[evt] = listeners[evt] || []).push(fn); },
    _listeners: listeners
  };
  if(opts.withArtifactStorage){
    windowObj.storage = opts.artifactImpl;
  }

  return {
    window: windowObj,
    document: documentObj,
    localStorage: localStorageObj,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    JSON: JSON,
    Date: Date,
    Math: Math,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    Boolean: Boolean,
    _localStore: localStore
  };
}

module.exports = { FakeElement, makeSandbox };
