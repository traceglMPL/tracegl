
		module.exports.reloader = function(donothing, verbose){
			if(donothing) return

			var p // process
			var k // killed
			var d = 0 // delta
			var t = 0 // times
			var w = {} // file watchers
			var a = process.argv

			if(a[2] == '-reloader'){
				a.splice(2,1)
				logreq = 1 // signal require to log files
				return
			}
			global.define = function(){}

			function watch(f){
				if(w[f]) return
				if(verbose) console.log("watching",f)
				w[f] = fs.watch(f, function(event){
					if(Date.now() - d < 2000) return
					console.log("---- "+f+" changed, reloading backend x"+t+" ----")
					if(k < 0) return reload()
					k = 1
					d = Date.now()
					p.kill('SIGKILL')
				})
			}

			function reload(){
				t++
				d = Date.now()
				k = 0
				var na = [a[1], '-reloader']
				na.push.apply(na, a.slice(2))
				p = cp.spawn("node", na)

				watch(a[1])
				p.stdout.on('data', function(d){
					process.stdout.write(d)
				})
				p.stderr.on('data', function(d){
					d = d.toString().replace(/<\[<\[(.*?)\]>\]>/g, function(a, f){
						watch(f)
						return ''
					})
					process.stderr.write(d)
				})
				p.on('exit', function(code){
					if(k) reload()
					else k = -1
				})
			}
			reload()
		}
		return
	} 


	//RELOADER
	if(typeof window != 'undefined' && window.location.origin != 'file://'){
		function reloader(){
			rtime = Date.now()
			var x = new XMLHttpRequest()
			x.onreadystatechange = function(){
				console.log('reload here', x.readyState)
				if(x.readyState != 4) return
				if(x.status == 200){
					// we can filter on filename
					if(typeof define === 'undefined' || !define.reload || !define.reload(x.responseText))
						return location.href = location.href
				}
				setTimeout(reloader, (Date.now() - rtime) < 1000?500:0)
			}
			x.open('GET', "/_reloader_")
			x.send()	
		}
		reloader()
	}
	//RELOADER	
