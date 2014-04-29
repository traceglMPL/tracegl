// | Browser <> Node.JS communication channels |__/
// |
// |  (C) Code.GL 2013
// \____________________________________________/

define(function(require, exports, module){

	if(typeof process !== "undefined"){

		var cr = require('crypto')
		// | Node.JS Path
		// \____________________________________________/
		module.exports = function(url){
			var ch = {}

			var pr // poll request
			var pt // poll timer
			var nc /*no cache header*/ = {"Content-Type": "text/plain","Cache-Control":"no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0"}
			var sd = []// send data
			var ws // websocket
			var wk // websocket keepalive
			var st // send timeout

			function wsClose(){
				if(ws) ws.destroy(), ws = 0
				if(wk) clearInterval(wk), wk = 0
			}

			function endPoll(c, d){ // end poll http status code, data
				if(!pr) return
				pr.writeHead(c, nc)
				pr.end(d)
				pr = null
			}

			ch.handler = function(req, res){
				if(req.url != url) return
				if(req.method == 'GET'){ // Long poll
					endPoll(304)
					if(pt) clearInterval(pt), pt = 0
					pt = setInterval(function(){endPoll(304)}, 30000)
					pr = res
					if(sd.length) endPoll(200, '['+sd.join(',')+']'), sd.length = 0 // we have pending data
					return 1
				}

				if(req.method == 'PUT'){ // RPC call
					var d = ''
					req.on('data', function(i){ d += i.toString() })
					req.on('end', function(){
						if(!ch.rpc) return res.end()
						d = parse(d)
						if(!d) return res.end()
						ch.rpc(d, function(r){
							res.writeHead(200, nc)
							res.end(JSON.stringify(r))
						})
					})
					return 1
				}

				if(req.method == 'POST'){ // Message  
					var d = ''
					req.on('data', function(i){ d += i.toString() })
					req.on('end', function(){
						res.writeHead(204, nc)
						res.end()
						d = parse(d)
						if(ch.data && d && d.length) for(var i = 0;i<d.length;i++) ch.data(d[i])
					})
					return 1
				}
			}

			ch.upgrade = function(req, sock, head){
				if(req.headers['sec-websocket-version'] != 13) return sock.destroy()
				wsClose()
				ws = sock

			   // calc key
				var k = req.headers['sec-websocket-key']
				var sha1 = cr.createHash('sha1');
				sha1.update(k + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
				var v = 'HTTP/1.1 101 Switching Protocols\r\n'+
					'Upgrade: websocket\r\n'+
					'Connection: Upgrade\r\n'+
					'Sec-WebSocket-Accept: ' + sha1.digest('base64') +'\r\n'+
					'Sec-WebSocket-Protocol: ws\r\n\r\n'
				ws.write(v)

				var max = 100000000
				var h = new Buffer(14) // header
				var o = new Buffer(10000) // output
				var s = opcode // state
				var e = 1// expected
				var w = 0// written
				var r // read
				var i // input

				var m // mask offset
				var c // mask counter
				var l // payload len

				function err(t){
					console.log('websock '+t)
					wsClose()
				}

				function head(){
					var se = e
					while(e > 0 && r < i.length && w < h.length) h[w++] = i[r++], e--
					if(w > h.length) return err("unexpected data in header"+ se + s.toString())
					return e != 0
				}

				function data(){
					while(e > 0 && r < i.length) o[w++] = i[r++] ^ h[m + (c++&3)], e--
					if(e) return 
					var d = parse(o.toString('utf8', 0, w))
					if(ch.data && d && d.length) {
						for(var j = 0;j<d.length;j++) ch.data(d[j])
					}
					return e = 1, w = 0, s = opcode
				}

				function mask(){
					if(head()) return
					if(!l) return e = 1, w = 0, s = opcode
					m = w - 4
					w = c = 0
					e = l
					if(l > max) return err("buffer size request too large "+l+" > "+max)
					if(l > o.length) o = new Buffer(l)
					return s = data
				}

				function len8(){
					if(head()) return
					return l = h.readUInt32BE(w - 4), e = 4, s = mask
				}

				function len2(){
					if(head()) return 
					return l = h.readUInt16BE(w - 2), e = 4, s = mask
				}

				function len1(){
					if(head()) return
					if(!(h[w  - 1] & 128)) return err("only masked data")
					var t = h[w - 1] & 127
					if(t < 126) return l = t, e = 4, s = mask
					if(t == 126) return e = 2, s = len2
					if(t == 127) return e = 8, s = len8
				}

				function pong(){
					if(head()) return
					if(h[w-1] & 128) return e = 4, l = 0, s = mask 
					return e = 1, w = 0, s = opcode
				}

				function opcode(){
					if(head()) return
					var f = h[0] & 128
					var t = h[0] & 15
					if(t == 1){
						if(!f) return err("only final frames supported")
						return e = 1, s = len1
					}
					if(t == 8) return wsClose()
					if(t == 10) return e = 1, s = pong
					return err("opcode not supported " + t)
				}

				ws.on('data', function(d){
					i = d
					r = 0
					while(s());
				})

				var cw = ws
				ws.on('close', function(){
					if(cw == ws) wsClose()
					o = null
				})

				// 10 second ping frames
				var pf = new Buffer(2)
				pf[0] = 9 | 128
				pf[1] = 0
				wk = setInterval(function(){
					ws.write(pf)
				}, 10000)
			}

			function wsWrite(d){
				var h
				var b = new Buffer(d)
				if(b.length < 126){
					h = new Buffer(2)
					h[1] = b.length
				} else if (b.length<=65535){
					h = new Buffer(4)
					h[1] = 126
					h.writeUInt16BE(b.length, 2)
				} else {
					h = new Buffer(10)
					h[1] = 127
					h[2] = h[3] = h[4] =	h[5] = 0
					h.writeUInt32BE(b.length, 6)
				}
				h[0] = 128 | 1
				ws.write(h)
				ws.write(b)
			}

			ch.send = function(m){
				sd.push(JSON.stringify(m))
				if(!st) st = setTimeout(function(){
					st = 0
					if(ws) wsWrite('['+sd.join(',')+']'), sd.length = 0
					else
					if(pr) endPoll(200, '['+sd.join(',')+']'), sd.length = 0
				}, 0)
			}

			return ch
		}

		return
	}
	// | Browser Path
	// \____________________________________________/

	module.exports = 
	//CHANNEL
	function(url){
		var ch = {}

		var sd = [] // send data
		var bs = [] // back data
		var bi = 0 // back interval
		var ws // websocket
		var wt // websocket sendtimeout
		var wr = 0 //websocket retry
		var sx // send xhr
		var tm;

		function xsend(d){
			var d = '[' + sd.join(',') +']'
			sd.length = 0
			sx = new XMLHttpRequest()
			sx.onreadystatechange = function(){
				if(sx.readyState != 4) return
				sx = 0
				if(sd.length > 0) xsend()
			}
			sx.open('POST', url)
			sx.send(d)
		};

		function wsFlush(){
			if(ws === 1) {
				if(!wt){
					wt = setTimeout(function(){
						wt = 0
						wsFlush()
					},50)
				}
				return
			} else if (!ws){
				if(!ws) console.log('Websocket flooded, trace data lost')
			}
			if(sd.length){
				var data = '[' + sd.join(',') + ']'
				sd.length = 0
				if(bs.length || ws.bufferedAmount > 500000){
					bs.push(data)
					if(!bi) bi = setInterval(function(){
						if(ws && ws.bufferedAmount < 500000)
							ws.send(bs.shift())
						if(!ws || !bs.length) clearInterval(bi), bi = 0
						if(!ws) console.log('Websocket flooded, trace data lost')
					}, 10)
				} else ws.send(data)
			}
		}

		//| send json message via xhr or websocket
		ch.send = function(m){
			sd.push(JSON.stringify(m))
			if(ws){
				if(sd.length>10000) wsFlush()
				if(!wt) wt = setTimeout(function(){
					wt = 0
					wsFlush()
				},0)
			} else {
				if(!sx) return xsend()
			}
		}

		function poll(){
			var x = new XMLHttpRequest()
			x.onreadystatechange = function(){
				if(x.readyState != 4) return
				if(x.status == 200 || x.status == 304) poll()
				else setTimeout(poll, 500)
				try{ var d = JSON.parse(x.responseText) }catch(e){}
				if(d && ch.data && d.length) for(var i = 0;i<d.length;i++) ch.data(d[i])
			}
			x.open('GET', url)
			x.send()
		}

		ch.rpc = function(m, cb){ // rpc request
			var x = new XMLHttpRequest()
			x.onreadystatechange = function(){
				if(x.readyState != 4) return
				var d
				if(x.status == 200 ) try{d = JSON.parse(x.responseText) }catch(e){}
				if(cb) cb(d)
			}
			x.open('PUT', url)
			x.send(JSON.stringify(m))
			return x
		}

		function websock(){
			var u = 'ws://'+window.location.hostname +':'+window.location.port+''+url
			var w = new WebSocket(u, "ws")
			ws = 1
			w.onopen = function(){
				ws = w
			}
			w.onerror = w.onclose = function(e){
				if(ws == w){ // we had a connection, retry
					console.log("Websocket closed, retrying", e)
					ws = 0
					websock()
				} else {
					console.log("Falling back to polling", e)
					ws = 0, poll()
				}
			}
			w.onmessage = function(e){
				var d = parse(e.data)
				if(d && ch.data) for(var i = 0;i<d.length;i++) ch.data(d[i])
			}
		}
		
		if(typeof no_websockets !== "undefined" || typeof WebSocket === "undefined") poll()
		else websock()
		//poll()
		return ch
	}

	function parse(d){ // data
		try{ return JSON.parse(d);	}catch (e){ return }
	}

	//CHANNEL
})