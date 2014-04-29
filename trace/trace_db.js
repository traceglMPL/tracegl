// | UI trace database |________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require, exports, module){
	
	var fn = require("../core/fn")
	var ui = require("../core/ui")
	var tm = require("../core/text_mix")

	function traceDb(o){
		// we store the trace list and databases
		var db = {sh:{}}	

		// put a textstore on the db object
		tm.storage(db)

		// fire a changed event
		db.changed = fn.ps()

		// file and line dictionaries
		db.lineDict = o?o.lineDict:{} // line dictionary
		db.fileDict = o?o.fileDict:{}
		db.msgIds = {}

		// trace message
		//  i - line index
		//  a - arguments
		//  d - depth
		//  c - call entry ID
		//  r - return message
		//  t - type
		//  s - searchable text
		//  y - y coordinate 
		//  b000 - block marker

		// line object
		//   fid - file ID
		//   ret - function return index (for return)
		//   x - x coordinate 
		//   y - y coordinate 
		//   ex - end x
		//   ey - end y
		//   n - function name
		//   a - argument name array

		// file dictionary
		//  longName
		//  shortName

		var fid = 0 // file id

		// trace colors
		db.colors = {
			def:ui.t.codeName,
			i:ui.t.codeName,
			s:ui.t.codeString,
			a:ui.t.codeOperator,
			n:ui.t.codeNumber,
			v:ui.t.codeVardef,
			t:ui.t.codeName,
			c:ui.t.codeComment,
			1:ui.t.codeColor1,
			2:ui.t.codeColor2,
			3:ui.t.codeColor3,
			4:ui.t.codeColor4,
			5:ui.t.codeColor5,
			6:ui.t.codeColor6,
			7:ui.t.codeColor7,
			8:ui.t.codeColor8
		}

		var last
		var lgc = 0
		db.processTrace = function(m){

			if(!lgc) lgc = m.g
			else{
				if(lgc + 1 != m.g){
					fn("Message order discontinuity", lgc, m.g)
				}
				lgc = m.g
			}

			// look up trace message
			var l = db.lineDict[m.i]
			if(!l){
				fn('got trace without lookup')
				return
			}

			// make callstack parents
			if(!last){ 
				if(l.n) last = m
			} else {
				if(m.d > last.d) m.p = last, last = m
				else { // depth is equal or less
					if(l.ret){ // we are a return/
						// store us as the return message
						// check if we can be a return from last
						if(l.ret != last.i){
							var l2 = db.lineDict[l.ret]
							var n2 = db.fileDict[l2.fid].longName 
							var l3 = db.lineDict[last.i]
							var n3 = db.fileDict[l3.fid].longName
							fn('invalid return',m.i, n2, l2.n, l2.y, n3, l3.n, l3.y)
						}
						last.r = m
						// add return to text search field
						last.s += ' '+db.fmtCall(m).replace(/\f[a-zA-Z0-9]/g,'')
					} else {

						//var l2 = db.lineDict[l.ret]
						var n2 = db.fileDict[l.fid].longName 

						var l3 = db.lineDict[last.i]
						var n3 = db.fileDict[l3.fid].longName
						// non return following
						//	fn('missed return from', n3, l3.n,l3.y, 'got', m.i, n2, l.n, l.y)
						fn(m.i, l)
					}
					// if we are not a  return(m.f)
					var d = (last.d - m.d) + 1
					while(d > 0 && last) last = last.p, d--
					if(l.n){
						m.p = last, last = m
					}
				}
			}
			// add our line if  we are a function call
			if(l.n){
				if(last && last.p){ // store our call on 
					if(last.p.cs)	m.nc = last.p.cs
					last.p.cs = m
				}
				m.y = db.th
				var dp = m.d > 64 ? 64 : m.d
				db.addTabs(dp, 1, ui.t.codeTab)
				var t = db.fmtCall(m)
				db.addFormat((m.d>dp?'>':'')+t, db.colors)
				db.endLine(m)
				// keep a ref
				if(!db.firstMessage) db.firstMessage = m

				db.msgIds[m.g] = m

				// chain the closures
				var u = db.msgIds[m.u]
				if(u){
					if(u.us) m.nu  = u.us
					u.us = m
				}

				m.s = t.replace(/\f[a-zA-Z0-9]/g,'')

				db.changed()
				return true
			}
		}

		db.find = function(id){
			return db.msgIds[id]
		}

		db.addTrace = function(m){
			db.addFormat(db.fmtCall(m), db.colors)
			db.endLine(m)
		}

		db.fmt  = function(v, lim){
			lim = lim || 255
			var t = typeof v
			if(t == 'string'){
				if(v.indexOf('_$_') == 0){
					v = v.slice(3)
					if(v == 'undefined') return '\fn'+v
					return '\fv' + v
				}
				return '\fs'+JSON.stringify(v)
			}
			if(t == 'number') return '\fn'+v
			if(t == 'boolean') return '\fn'+v
			if(t == 'undefined') return '\fnundefined'
			if(!v) return '\fnnull'
			if(Array.isArray(v)){
				var s = '\fi['
				for(var k in v){
					if(s.length!=3) s+='\fi,'
					s += db.fmt(v[k])
				}
				s += '\fi]'
				if(s.length>lim) return s.slice(0,lim)+' \fv...\fi]'
			} else {
				var s = '\fi{'
				for(var k in v){
					if(s.length!=3) s+='\fi,'
					if(k.indexOf(' ')!=-1) s+='\fs"'+ k+'"'+'\fi:'
					else s += '\ft' + k + ':'
					t = typeof v[k]
					s += db.fmt(v[k])
				}
				s += '\fi}'
				if(s.length>lim) return s.slice(0,lim)+' \fv...\fi}'
			}
			return s
		}

		db.modColor = function(mod){
			var uid = 0
			for(var i = 0;i<mod.length;i++) uid += mod.charCodeAt(i)
			return (uid)%8 + 1
		}

		// returns a formatted function traceline
		db.fmtCall = function(m){
			if(m.x){
				return '\faexception '+(m.v===undefined?'':db.fmt(m.v))
			} 
			var l = db.lineDict[m.i]
			var mod = db.fileDict[l.fid].shortName 
			var col = db.modColor(mod)
	
			if(l.ret){ // function return
				var f = db.lineDict[l.ret]
				return '\fareturn '+(m.v===undefined?'':db.fmt(m.v))
			} else {
				var s = []
				for(var i = 0;i<l.a.length;i++) s.push('\ft'+l.a[i].n + '\fa=' + db.fmt(m.a[i]))
				return '\f'+col+mod+ '\fa \fi'+l.n+'\fi('+s.join('\fi,')+'\fi)'
			}
		}

		// adds a dictionary
		db.addDict = function(m){
			var d = m.d
			for(var k in d){
				db.lineDict[k] = d[k]
				db.lineDict[k].fid = fid
			}
			var sn = m.f.match(/[\/\\]([^\/\\]*)(?:.js)$/)
			sn = sn?sn[1]:m.f
			db.fileDict[fid++] = {
				longName:m.f,
				shortName:sn
			}
		}

		return db
	}

	return traceDb
})
