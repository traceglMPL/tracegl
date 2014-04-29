// | Trace Client|________________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/   

define(function(require){
	define.settings = define.settings || {}
	document.title = "traceGL"
	
	var fn = require("../core/fn")
	var ui = require("../core/ui")
	if(!ui.gl) return

	var ct = require("../core/controls")

	var themes = require("../core/themes")
	
	var theme_type = define.settings.theme || 'dark'
	ui.theme(themes[define.settings.theme] || themes.dark)// set theme

	var ioChannel = require("../core/io_channel")

	var traceDb = require('./trace_db')
	var codeDb = require('./code_db')
	var listView = require('./list_view')
	var codeView = require("./code_view")
	var hoverText = require("./hover_text")
	var codeBubble = require("./code_bubble")

	var pass = fn.sha1hex("p4ssw0rd")
	var sess = fn.rndhex(8)
	var chan = ioChannel("/io_"+sess+"_"+pass)
	var dt = fn.dt()

	var instrument = require('./instrument')

	window.ui = ui

	// theme reloading when file change
	define.reload = function(t){
		console.log(t)
		if(t.indexOf('themes.js') != -1){ // reload themes
			require.reload('../core/themes', function(t){
				ui.theme(t.dark)
				ui.redraw()
			})
			return 1 // dont refresh the browser
		}
	}
	ui.load(function(){

		var tdb = traceDb()
		var sdb = traceDb(tdb)
		var cdb = codeDb()

		var paused 
		var paused_m

		// io channel data function
		chan.data = function(m){
			if(m.dict){
				// parse incoming source
				cdb.parse(m.f, m.src)
				return tdb.addDict(m)
			}
			else if(m.settings){
				define.settings = m.settings
				theme_type = define.settings.theme || 'dark'
				ui.theme(themes[define.settings.theme] || themes.dark)
				ui.redraw()
			} else {
				// we clicked pause, but we wont actually pause untill depth = 1
				if(paused && !paused_m)	if(m.d == 1) paused_m = paused;
				// we unpaused, but we wont unpause till we reach a depth = 1
				if(!paused && paused_m)	if(m.d == 1) paused_m = paused

				if(paused_m) return
	
				if(tdb.processTrace(m) && searchBox.t.length && !searcher && matchSearch(m)){
					sdb.addTrace(m)
					sdb.changed()
				}
			}
		}

		var bubbles = fn.list('prev', 'next')

		function clearTraces(){
			// clear the traceDb, searchDb
			// clear the bubbles and the 
			tdb.clearText()
			sdb.clearText()
			tdb.msgIds = {}
			tdb.firstMessage = null
			stackView.clearText()
			miniView.tvc = null
			bigView.tvc = null
			sminiView.tvc = null
			sbigView.tvc = null
			var b = bubbles.first()
			while(b){
				b.hide()
				b = b.next
			}
			tdb.changed()
			sdb.changed()
			ui.redraw()
		}

		function selectBubble(b, scroll){
			var n = bubbles.first()
			while(n){
				if(n != b) n.title.sel = 0
				n = n.next
			}
			b.title.sel = 1
			if(scroll){
				var v = bubbleBg._v_
				v.ds(b.y - v.mv)
				ui.redraw(bubbleBg)
			}
		}

		function selectCall(y){
			miniView.selectFirst(y)
			bigView.view(0, y, 0, 1, 1)
			// scroll up
			bubbleBg._v_.ds(-bubbleBg._v_.mv)
			stackView.ly = -1
			stackView.selectFirst(0)
		}

		// respond to a selectTrace by building all the callbubbles
		sdb.selectTrace = function(m){
			ui.dbg = m
			// lets select the  m in tdb
			selectCall(m.y)
		}

		tdb.selectTrace = function(m){
			//fn('selectTrace')
			var y = 0 // y pos
			var stacky = 0 // callstack counter
			var spacing = 1 // spacing between bubbles
			var rev = false // reverse callstack
			var b = {next:bubbles.first()}
			var max = 64
			stackView.clearText()

			if(rev) while(m.p) m.p.c = m, m = m.p
			while(m && max >0){
				max--
				// lookup line and file
				var l = tdb.lineDict[m.i]
				var f = tdb.fileDict[l && l.fid]
				if(!f){m = m.c;continue;}

				// find available bubble for stack
				if(b) b = b.next
				if(!b){
					b = codeBubble({x:1, y:y, w:'p.w', h:300, _p:bubbleBg})
					bubbles.add(b);
					// sync selection between title and
					(function(prev){
						b.title.p = function(n){
							var b = n._p
							b.resetLine()
							stackView.selectFirst(stackView.ly = b.stacky)
							selectBubble(b)
							ui.redraw(bubbleBg)
							prev()
						}
					})(b.title.p)
					b.clickLine = function(file, line){
						chan.send({t:'open',file:file,line:line})
					}
				}

				// stackView cursor
				b.stacky = stacky

				// build up the stackView
				stackView.addFormat( tdb.fmtCall(m), tdb.colors ), stacky++
				stackView.endLine(b)
				if(m.r && m.r.v !== '_$_undefined' && m.r.v !== undefined){
					stackView.addFormat( ' '+tdb.fmtCall(m.r), tdb.colors ), stacky++
					stackView.endLine(b)
					b.stackh = 2
				} else b.stackh = 1

				// set the title on the bubble
				var headSize = b.setTitle(m, tdb)

				// position bubble
				b.x = 0
				b.y = y

				// select text in bubble 
				var file = cdb.files[f.longName]
				var line = l.y

				// get the function body height
				var height = (l.ey - l.y + 1) * b.body.vps.sy + headSize + 20
				if(height > 6000) height = 6000

				// check if we have to fetch the file
				b.setBody( m, tdb, file, line, height)
				y += height + spacing
				// flip visibility
				if(b.l == -1) b.show()//b.l = b.l2

				// remove callstack reversal
				if(rev){
					var c = m.c
					delete m.c
					m = c
				}
				else m = m.p
			}
			// set total view width
			bubbleBg.vSize = y
			bubbleBg.v_()
			// reset cursor
			stackView.selectFirst(0)
			stackView.hy = 0
			stackView.v_()
			//bubbleBg._h_.ds(bubbleBg.hSize - bubbleBg.hScroll)
			// scroll to end
			ui.redraw()
			// hide left over bubbles
			b = b.next
			while(b){
				if(b.l != -1) b.hide()
				b = b.next
			}
		}

		// main UI
		var mainGroup
		var searchGroup
		var miniView
		var bigView
		var sminiView
		var sbigView
		var hoverView
		var sourceView
		var bubbleBg
		var searchBox

		var searcher

		var pattern = 0
		var regexp = 0
		function matchSearch(m){
			var s = searchBox.t
			if(s != pattern){
				if(s.charAt(0) == '/'){
					try{
						regexp = new RegExp(s.slice(1),"ig")
					} catch(e){
						regexp = 0				
					}
				} else regexp = 0
				pattern = s
			}
			if(!regexp)	return m.s.indexOf( pattern ) != -1	
			else return m.s.match( regexp ) != null
		}

		function doSearch(){
			var s = searchBox.t
			if(s.length){
				mainGroup.hide()
				searchGroup.show()
				// first we clear the sdb
				sdb.clearText()
				if(searcher) clearInterval(searcher)
				sminiView.tvc = null
				sbigView.tvc = null
				var n = tdb.text.first()
				searcher = setInterval(function(){
					var dt = fn.dt()
					// we process n and a few others
					var ntraces = 1000
					var nblocks = 500
					while(n && nblocks>0 && ntraces>0){
						// go through the lines
						for(var i = 0;i<n.ld.length;i++){
							var m = n.ld[i]
							// simple search
							if(matchSearch(m)){
								ntraces--
								sdb.addTrace(m)
							}
						}
						nblocks--
						n = n._d
					}
					sdb.changed()
					if(!n) clearInterval(searcher), searcher = 0
				}, 0)

			} else {
				mainGroup.show()
				searchGroup.hide()
			}
		}

		// main UI
		ui.group(function(n){
			ui.rect(function(n){
				n.f = 't.defbg'
				n.h = 32
				ct.button({
					y:2,
					x:2,
					w:80,
					t:'Theme',
					c:function(){
						if(theme_type == 'dark') theme_type = 'light'
						else theme_type = 'dark'
						ui.theme(themes[theme_type])
					}
				})
				ct.button({
					y:2,
					x:84,
					w:80,
					t:'Clear',
					c:function(){
						clearTraces()
					}
				})
				ct.button({
					y:2,
					w:80,
					x:166,
					t:'Pause',
					c:function(n){
						if(!n.paused){
							paused = n.paused = true
							n.ohc = n.hc
							n.hc = 'vec4(1,0,0,1)'
						} else {
							paused = n.paused = false
							n.hc = n.ohc
						}

						// restart the nodejs app under testing and clears traces
					}
				})			
				ct.button({
					y:2,
					x:248,
					w:22,
					t:'x',
					c:function(){
						searchBox.t = ""
						doSearch()
					}
				})		
				searchBox = ct.edit({
					empty:'search filter',
					y:2,
					x:272,
					w:'p.w - n.x',
					c:function(n){
						doSearch()
					}
				})
			})
			ct.vSplit(function(n){
				n.y = 28

				ui.group(function(n){
					n.h = 200
						ui.test = function(){
							fn(n.eval('h'))
						}
					mainGroup = ct.hSplit(function(n){
						miniView = listView({w:267, zm:0, db:tdb})
						bigView = listView({db:tdb, cursor:miniView})
						// we also have a textView here which we flip to visible occasionally
						// set alloc shader
						cdb.sh.text = miniView.sh.text
					})
					searchGroup = ct.hSplit(function(n){
						sminiView = listView({w:267, zm:0, db:sdb})
						sbigView = listView({db:sdb, cursor:sminiView})
						sbigView.vps.gx = 7
					})
					searchGroup.hide()
				})					

				ct.hSplit(function(n){
					stackView = listView({w:267})
					stackView.vps.gx = 5
					stackView.vps.gy = 5
					stackView.ly = -1
					stackView.viewChange = function(x, y){
						if(stackView.ly != y){
							stackView.ly = y
							var c = stackView.dcs.l.first() || stackView.vcs.l.first()
							if(c && c.d) selectBubble(c.d, true)
						}
					}
					bubbleBg = ui.rect(function(n){
						n.f = 't.defbg'//mix(vec4(.2,.2,.2,1),vec4(.4,.4,.4,1),c.y)'
						n.l = 1
						n._h_ = ct.hScrollHider()
						n._v_ = ct.vScrollHider()
						ct.hvScroll(n)
					})
				})

			})
			// the hover info view
			n.hoverView = hoverView = hoverText()
			n.miniView = miniView
			n.bigView = bigView
			n.bubbleBg = bubbleBg
			n.stackView = stackView
			n.selectCall = selectCall
			hoverView.show(false)
		})

		chan.send({t:'join'})

		ui.drawer()
	})
})