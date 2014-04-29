// | GLSL Extension lib |_______________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/  

define(function(require, exports){
	"no tracegl"
	var fn = require("./fn")

	var e = exports

	e.i0 = function(){ clamp(step(0, -n.a0) + (u - n.t0)/n.a0, 0, 1) } 
	e.i1 = function(){ clamp(step(0, -n.a1) + (u - n.t1)/n.a1, 0, 1) }
	e.i2 = function(){ clamp(step(0, -n.a2) + (u - n.t2)/n.a2, 0, 1) }
	e.i3 = function(){ clamp(step(0, -n.a3) + (u - n.t3)/n.a3, 0, 1) }
	e.i4 = function(){ clamp(step(0, -n.a4) + (u - n.t4)/n.a4, 0, 1) }
	e.i5 = function(){ clamp(step(0, -n.a5) + (u - n.t5)/n.a5, 0, 1) }
	e.i6 = function(){ clamp(step(0, -n.a6) + (u - n.t6)/n.a6, 0, 1) }
	e.i7 = function(){ clamp(step(0, -n.a7) + (u - n.t7)/n.a7, 0, 1) }
	e.i8 = function(){ clamp(step(0, -n.a8) + (u - n.t8)/n.a8, 0, 1) }
	e.i9 = function(){ clamp(step(0, -n.a9) + (u - n.t9)/n.a9, 0, 1) }

	e.tsin  = function(x) { (0.5 * sin(x) + 0.5) }
	e.tcos  = function(x) { (0.5 * cos(x) + 0.5) }
	e.len   = function(x) { length(x) }
	e.rad   = function(xp, yp){
		sqrt(pow(c.x, 2 + xp) + pow(c.y, 2 + yp))
	}

	e.theme = function(i){
		texture2D(T,vec2(i,0))
	}

	function img(c){
		texture2D(1, w.x, w.y)
	}

	e.dbg = function(c){
		vec4(w.x, w.y, 1-w.y, 1)
	}

	e._tf_ = 1
	e.linx = function(){
		(c.x)
	}

	e.liny = function(){
		(c.y)
	}

	e.ts = function(a){
		(0.5*sin(a*t)+0.5)
	}

	e.tc = function(a){
		(0.5*cos(a*t)+0.5)
	}

	e.rotate = e.rot = function(r, _fw_){
		_fw_(vec2((c.x-.5) * cos(r) - (c.y-.5) * sin(r), (c.x-.5) * sin(r) + (c.y-.5) * cos(r))+.5)
	}

	e.scale = function(x, y, _fw_){
		_fw_(((c-.5)*vec2(x,y))+.5)
	}

	e.move = function(x, y, _fw_){
		_fw_(c-vec2(x,y))
	}

	e.spiral = function(r, _fw_){
		_fw_(vec2((c.x-.5) * cos(r*len(c-.5)) - (c.y-.5) * sin(r*len(c-.5)), (c.x-.5) * sin(r*len(c-.5)) + (c.y-.5) * cos(r*len(c-.5)))+.5)
	}

	e.pixel = function(x, y, _fw_){
		_fw_(vec2(floor((c.x-.5)*x)/x,floor((c.y-.5)*y)/y)+.5) 
	}

	e.normal_ = function(float_ln, float_n1, float_n2, float_n3){
		return_vec3( 
			cross(
				normalize(vec3(0,ln,n2-n1)),
				normalize(vec3(ln,0,n3-n1))
			)

			
		);
	}

	e.mask = function(float_a, vec4_c){
		return_vec4(c.x,c.y,c.z,a)
	}

	e.pow2 = function(float_xp, float_yp,  vec2_c){
		return_vec2(pow(c.x,pow(xp,1.2)), pow(c.y,pow(yp,1.2)))
	}

	e.hermite = function(float_t, float_p0, float_p1, float_m0, float_m1){
	   float_t2 = t*t;
	   float_t3 = t2*t;
	   return_float((2*t3 - 3*t2 + 1)*p0 + (t3-2*t2+t)*m0 + (-2*t3+3*t2)*p1 + (t3-t2)*m1);
	}
	
	e.normal = function(ds, ln, float_fw_vec2_c){
		normal_(ln,
				  float_fw_vec2_c(vec2(c.x, c.y)),
				  float_fw_vec2_c(vec2(c.x+ds, c.y)),
				  float_fw_vec2_c(vec2(c.x, c.y+ds)))
	}

	e.img = function(a){
		texture2D(a, vec2(c.x, c.y))
	}	
	
	e.font = function(){
		texture2D(n.b,vec2(e.z, e.w))
	}

	e.fontgrow = function(){
		return_vec4(
			(
				texture2D(n.b,vec2(e.z - 'n.b'.x, e.w - 'n.b'.y)) +
				texture2D(n.b,vec2(e.z, e.w - 'n.b'.y)) +
				texture2D(n.b,vec2(e.z + 'n.b'.x, e.w - 'n.b'.y)) +
				texture2D(n.b,vec2(e.z - 'n.b'.x, e.w)) +
				texture2D(n.b,vec2(e.z, e.w)) +
				texture2D(n.b,vec2(e.z + 'n.b'.x, e.w)) +
				texture2D(n.b,vec2(e.z - 'n.b'.x, e.w + 'n.b'.y)) +
				texture2D(n.b,vec2(e.z, e.w + 'n.b'.y)) +
				texture2D(n.b,vec2(e.z+ 'n.b'.x, e.w + 'n.b'.y))
			))
	}

	e.fontshift = function(){
		texture2D(n.b,vec2(e.z- 'n.b'.x, e.w - 'n.b'.y))
	}

	e.blend = function(vec4_a, vec4_b){
		return_vec4( a.xyz * (1-b.w) + (b.w)*b.xyz, max(a.w,b.w) )
	}
	
	e.subpix = function(vec4_c, vec4_fg, vec4_bg){
		float_a(3.2*(t.subpx).w)
		return_vec4(vec4(pow(c.r * pow(fg.r, a) + (1-c.r) * pow(bg.r, a), 1/a),
					 pow(c.g * pow(fg.g, a) + (1-c.g) * pow(bg.g, a), 1/a),
					 pow(c.b * pow(fg.b, a) + (1-c.b) * pow(bg.b, a), 1/a), 
					 c.a*fg.a)*1.0)
	}

	e.sfont = function(vec4_fg, vec4_bg){
		vec4_c( texture2D(n.b, vec2(e.z, e.w)) )
		float_a(3.2*(t.subpx).w)
		return_vec4(vec4(pow(c.r * pow(fg.r, a) + (1-c.r) * pow(bg.r, a), 1/a),
					 pow(c.g * pow(fg.g, a) + (1-c.g) * pow(bg.g, a), 1/a),
					 pow(c.b * pow(fg.b, a) + (1-c.b) * pow(bg.b, a), 1/a), 
					 c.a*fg.a))
	}

	e.sfont2 = function(vec4_fg, vec4_bg, float_a){
		vec4_c( texture2D(n.b, vec2(e.z, e.w)) )
		return_vec4(vec4(pow(c.r * pow(fg.r, a) + (1-c.r) * pow(bg.r, a), 1/a),
					 pow(c.g * pow(fg.g, a) + (1-c.g) * pow(bg.g, a), 1/a),
					 pow(c.b * pow(fg.b, a) + (1-c.b) * pow(bg.b, a), 1/a), 
					 c.a*fg.a))
	}

	e.alpha = function(vec4_i, float_a){
		return_vec4(i.x,i.y,i.z,a)
	}

	// we return a function based on the number of arguments
	e.mix = function(){
		var a = arguments
		var l = a.length

		var s = 'vec4 #('
		for(var i = 0;i < l - 1; i++){
			s+= (i?',vec4 a':'vec4 a')+i
		}
		s += ',float f){\n return '
		for(var i = 0; i < l - 2; i++){
			s += 'mix(a' + i + ','
			if(i == l - 3) {
				s += 'a'+(i+1)
				while(i >= 0) {
					s += ',clamp(f' + (l>3 ? '*'+(l - 2)+'.-'+(i)+'.' : '')+ ',0.,1.))'
					i--
				}
				break
			}
		}
		s += ';\n}\n'
		return s
	}

	// Seriously awesome GLSL noise functions. (C) Credits and kudos go to
	// Stefan Gustavson, Ian McEwan Ashima Arts
	// Google keywords: GLSL simplex noise
	// MIT License. 
	
	e.permute1 = function(float_x) {
		return_float( mod((34.0 * x + 1.0) * x, 289.0) );
	}
	
	e.permute3 = function(vec3_x) {
		return_vec3( mod((34.0 * x + 1.0) * x, 289.0) );
	}

	e.permute4 = function(vec4_x) {
		return_vec4( mod((34.0 * x + 1.0) * x, 289.0) );
	}
	
	e.isqrtT1 = function(float_r){
	  return_float(1.79284291400159 - 0.85373472095314 * r);
	}

	e.isqrtT4 = function(vec4_r){
	  return_vec4(1.79284291400159 - 0.85373472095314 * r);
	}

	e.snoise2 = function(vec2_v){
		vec4_C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439); 
		vec2_i  = floor(v + dot(v, C.yy) );
		vec2_x0 = v -   i + dot(i, C.xx);

		vec2_i1;
		i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
		vec4_x12 = x0.xyxy + C.xxzz;
		x12.xy -= i1;

		i = mod(i, 289.0); // Avoid truncation effects in permutation
		vec3_p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0 ));

		vec3_m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
		m = m*m;
		m = m*m;

		vec3_x = 2.0 * fract(p * C.www) - 1.0;
		vec3_h = abs(x) - 0.5;
		vec3_ox = floor(x + 0.5);
		vec3_a0 = x - ox;
		m *= (1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h ));
		vec3_g;
		g.x  = a0.x  * x0.x  + h.x  * x0.y;
		g.yz = a0.yz * x12.xz + h.yz * x12.yw;
		return_float(130.0 * dot(m, g));
	}

	e.snoise3 = function(vec3_v){ 
		vec2_C = vec2(1.0/6.0, 1.0/3.0);
		vec4_D = vec4(0.0, 0.5, 1.0, 2.0);

		// First corner
		vec3_i = floor(v + dot(v, C.yyy));
		vec3_x0 = v - i + dot(i, C.xxx);
		vec3_g = step(x0.yzx, x0.xyz);
		vec3_l = 1.0 - g;
		vec3_i1 = min(g.xyz, l.zxy);
		vec3_i2 = max(g.xyz, l.zxy);
		vec3_x1 = x0 - i1 + 1.0 * C.xxx;
		vec3_x2 = x0 - i2 + 2.0 * C.xxx;
		vec3_x3 = x0 - 1. + 3.0 * C.xxx;

		// Permutations
		i = mod(i, 289.0);
		vec4_p = permute4(permute4(permute4( 
			i.z + vec4(0.0, i1.z, i2.z, 1.0))
			+ i.y + vec4(0.0, i1.y, i2.y, 1.0)) 
			+ i.x + vec4(0.0, i1.x, i2.x, 1.0));

		// ( N*N points uniformly over a square, mapped onto an octahedron.)
		float_n_ = 1.0/7.0;
		vec3_ns = n_ * D.wyz - D.xzx;
		vec4_j = p - 49.0 * floor(p * ns.z *ns.z);
		vec4_x_ = floor(j * ns.z);
		vec4_y_ = floor(j - 7.0 * x_);
		vec4_x = x_ * ns.x + ns.yyyy;
		vec4_y = y_ * ns.x + ns.yyyy;
		vec4_h = 1.0 - abs(x) - abs(y);
		vec4_b0 = vec4( x.xy, y.xy );
		vec4_b1 = vec4( x.zw, y.zw );
		vec4_s0 = floor(b0)*2.0 + 1.0;
		vec4_s1 = floor(b1)*2.0 + 1.0;
		vec4_sh = -step(h, vec4(0.0));
		vec4_a0 = b0.xzyw + s0.xzyw*sh.xxyy;
		vec4_a1 = b1.xzyw + s1.xzyw*sh.zzww;
		vec3_p0 = vec3(a0.xy,h.x);
		vec3_p1 = vec3(a0.zw,h.y);
		vec3_p2 = vec3(a1.xy,h.z);
		vec3_p3 = vec3(a1.zw,h.w);

		//Normalise gradients
		vec4_norm = isqrtT4(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
		p0 *= norm.x;
		p1 *= norm.y;
		p2 *= norm.z;
		p3 *= norm.w;

		// Mix final noise value
		vec4_m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
		m = m * m;
		return_float(42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
			dot(p2,x2), dot(p3,x3) ) ));
	}

	e.snoise4_g = function(float_j, vec4_ip)
	{
		vec4_p;
		p.xyz = floor( fract (vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
		p.w = 1.5 - dot(abs(p.xyz), vec3(1.0,1.0,1.0));
		vec4_s = vec4(lessThan(p, vec4(0.0)));
		p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www; 
		return_vec4(p);
	}

	e.snoise4 = function(vec4_v)
	{
		vec4_C = vec4(0.138196601125011,0.276393202250021,0.414589803375032,-0.447213595499958);
		// First corner
		vec4_i  = floor(v + dot(v, vec4(0.309016994374947451)) );
		vec4_x0 = v - i + dot(i, C.xxxx);
		vec4_i0;
		vec3_isX = step( x0.yzw, x0.xxx );
		vec3_isYZ = step( x0.zww, x0.yyz );
		i0.x = isX.x + isX.y + isX.z;
		i0.yzw = 1.0 - isX;
		i0.y += isYZ.x + isYZ.y;
		i0.zw += 1.0 - isYZ.xy;
		i0.z += isYZ.z;
		i0.w += 1.0 - isYZ.z;
		vec4_i3 = clamp( i0, 0.0, 1.0 );
		vec4_i2 = clamp( i0-1.0, 0.0, 1.0 );
		vec4_i1 = clamp( i0-2.0, 0.0, 1.0 );
		vec4_x1 = x0 - i1 + C.xxxx;
		vec4_x2 = x0 - i2 + C.yyyy;
		vec4_x3 = x0 - i3 + C.zzzz;
		vec4_x4 = x0 + C.wwww;
		// Permutations
		i = mod(i, 289.0 );
		float_j0 = permute1( permute1( permute1( permute1(i.w) + i.z) + i.y) + i.x);
		vec4_j1 = permute4( permute4( permute4( permute4(
			i.w + vec4(i1.w, i2.w, i3.w, 1.0 ))
			+ i.z + vec4(i1.z, i2.z, i3.z, 1.0 ))
			+ i.y + vec4(i1.y, i2.y, i3.y, 1.0 ))
			+ i.x + vec4(i1.x, i2.x, i3.x, 1.0 ));
		// Gradients: 7x7x6 points over a cube, mapped onto a 4-cross polytope
		// 7*7*6 = 294, which is close to the ring size 17*17 = 289.
		vec4_ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0) ;
		vec4_p0 = snoise4_g(j0,   ip);
		vec4_p1 = snoise4_g(j1.x, ip);
		vec4_p2 = snoise4_g(j1.y, ip);
		vec4_p3 = snoise4_g(j1.z, ip);
		vec4_p4 = snoise4_g(j1.w, ip);
		// Normalise gradients
		vec4_nr = isqrtT4(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
		p0 *= nr.x;
		p1 *= nr.y;
		p2 *= nr.z;
		p3 *= nr.w;
		p4 *= isqrtT1(dot(p4,p4));
		// Mix contributions from the five corners
		vec3_m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
		vec2_m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
		m0 = m0 * m0;
		m1 = m1 * m1;
		return_float(49.0 * (dot(m0*m0, vec3(dot( p0, x0 ), dot(p1, x1), dot(p2, x2)))
		+ dot(m1*m1, vec2( dot(p3, x3), dot(p4, x4)))));
	}

	e.cell = function(vec2_v){
		return_float(cell3(vec3(v.x, v.y,0)))
	}

	e.cell2 = function(vec3_P){
		float_K = 0.142857142857;// 1/7
		float_Ko = 0.428571428571;// 1/2-K/2
		float_K2 = 0.020408163265306;// 1/(7*7)
		float_Kz = 0.166666666667;// 1/6
		float_Kzo = 0.416666666667;// 1/2-1/6*2
		float_ji = 0.8;// smaller jitter gives less errors in F2
		vec3_Pi = mod(floor(P), 289.0);
		vec3_Pf = fract(P);
		vec4_Pfx = Pf.x + vec4(0.0, -1.0, 0.0, -1.0);
		vec4_Pfy = Pf.y + vec4(0.0, 0.0, -1.0, -1.0);
		vec4_p = permute4(Pi.x + vec4(0.0, 1.0, 0.0, 1.0));
		p = permute4(p + Pi.y + vec4(0.0, 0.0, 1.0, 1.0));
		vec4_p1 = permute4(p + Pi.z); // z+0
		vec4_p2 = permute4(p + Pi.z + vec4(1.0)); // z+1
		vec4_ox1 = fract(p1*K) - Ko;
		vec4_oy1 = mod(floor(p1*K), 7.0)*K - Ko;
		vec4_oz1 = floor(p1*K2)*Kz - Kzo; // p1 < 289 guaranteed
		vec4_ox2 = fract(p2*K) - Ko;
		vec4_oy2 = mod(floor(p2*K), 7.0)*K - Ko;
		vec4_oz2 = floor(p2*K2)*Kz - Kzo;
		vec4_dx1 = Pfx + ji*ox1;
		vec4_dy1 = Pfy + ji*oy1;
		vec4_dz1 = Pf.z + ji*oz1;
		vec4_dx2 = Pfx + ji*ox2;
		vec4_dy2 = Pfy + ji*oy2;
		vec4_dz2 = Pf.z - 1.0 + ji*oz2;
		vec4_d1 = dx1 * dx1 + dy1 * dy1 + dz1 * dz1; // z+0
		vec4_d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2; // z+1

		vec4_d= min(d1,d2); // F1 is now in d
		d2 = max(d1,d2); // Make sure we keep all candidates for F2
		d.xy = (d.x < d.y) ? d.xy : d.yx; // Swap smallest to d.x
		d.xz = (d.x < d.z) ? d.xz : d.zx;
		d.xw = (d.x < d.w) ? d.xw : d.wx; // F1 is now in d.x
		d.yzw = min(d.yzw, d2.yzw); // F2 now not in d2.yzw
		d.y = min(d.y, d.z); // nor in d.z
		d.y = min(d.y, d.w); // nor in d.w
		d.y = min(d.y, d2.x); // F2 is now in d.y
		return_vec2(sqrt(d.xy)); // F1 and F2
	}

	e.cell3 = function(vec3_P){
		float_K = 0.142857142857;
		float_Ko = 0.428571428571; // 1/2-K/2
		float_K2 = 0.020408163265306;// 1/(7*7)
		float_Kz = 0.166666666667;// 1/6
		float_Kzo = 0.416666666667;// 1/2-1/6*2
		float_ji = 1.0;// smaller jitter gives more regular pattern

		vec3_Pi = mod(floor(P), 289.0);
		vec3_Pf = fract(P) - 0.5;

		vec3_Pfx = Pf.x + vec3(1.0, 0.0, -1.0);
		vec3_Pfy = Pf.y + vec3(1.0, 0.0, -1.0);
		vec3_Pfz = Pf.z + vec3(1.0, 0.0, -1.0);

		vec3_p = permute3(Pi.x + vec3(-1.0, 0.0, 1.0));
		vec3_p1 = permute3(p + Pi.y - 1.0);
		vec3_p2 = permute3(p + Pi.y);
		vec3_p3 = permute3(p + Pi.y + 1.0);
		vec3_p11 = permute3(p1 + Pi.z - 1.0);
		vec3_p12 = permute3(p1 + Pi.z);
		vec3_p13 = permute3(p1 + Pi.z + 1.0);
		vec3_p21 = permute3(p2 + Pi.z - 1.0);
		vec3_p22 = permute3(p2 + Pi.z);
		vec3_p23 = permute3(p2 + Pi.z + 1.0);
		vec3_p31 = permute3(p3 + Pi.z - 1.0);
		vec3_p32 = permute3(p3 + Pi.z);
		vec3_p33 = permute3(p3 + Pi.z + 1.0);

		vec3_ox11 = fract(p11*K) - Ko;
		vec3_oy11 = mod(floor(p11*K), 7.0)*K - Ko;
		vec3_oz11 = floor(p11*K2)*Kz - Kzo; // p11 < 289 guaranteed
		vec3_ox12 = fract(p12*K) - Ko;
		vec3_oy12 = mod(floor(p12*K), 7.0)*K - Ko;
		vec3_oz12 = floor(p12*K2)*Kz - Kzo;
		vec3_ox13 = fract(p13*K) - Ko;
		vec3_oy13 = mod(floor(p13*K), 7.0)*K - Ko;
		vec3_oz13 = floor(p13*K2)*Kz - Kzo;
		vec3_ox21 = fract(p21*K) - Ko;
		vec3_oy21 = mod(floor(p21*K), 7.0)*K - Ko;
		vec3_oz21 = floor(p21*K2)*Kz - Kzo;
		vec3_ox22 = fract(p22*K) - Ko;
		vec3_oy22 = mod(floor(p22*K), 7.0)*K - Ko;
		vec3_oz22 = floor(p22*K2)*Kz - Kzo;
		vec3_ox23 = fract(p23*K) - Ko;
		vec3_oy23 = mod(floor(p23*K), 7.0)*K - Ko;
		vec3_oz23 = floor(p23*K2)*Kz - Kzo;
		vec3_ox31 = fract(p31*K) - Ko;
		vec3_oy31 = mod(floor(p31*K), 7.0)*K - Ko;
		vec3_oz31 = floor(p31*K2)*Kz - Kzo;
		vec3_ox32 = fract(p32*K) - Ko;
		vec3_oy32 = mod(floor(p32*K), 7.0)*K - Ko;
		vec3_oz32 = floor(p32*K2)*Kz - Kzo;
		vec3_ox33 = fract(p33*K) - Ko;
		vec3_oy33 = mod(floor(p33*K), 7.0)*K - Ko;
		vec3_oz33 = floor(p33*K2)*Kz - Kzo;

		vec3_dx11 = Pfx + ji*ox11;
		vec3_dy11 = Pfy.x + ji*oy11;
		vec3_dz11 = Pfz.x + ji*oz11;
		vec3_dx12 = Pfx + ji*ox12;
		vec3_dy12 = Pfy.x + ji*oy12;
		vec3_dz12 = Pfz.y + ji*oz12;
		vec3_dx13 = Pfx + ji*ox13;
		vec3_dy13 = Pfy.x + ji*oy13;
		vec3_dz13 = Pfz.z + ji*oz13;
		vec3_dx21 = Pfx + ji*ox21;
		vec3_dy21 = Pfy.y + ji*oy21;
		vec3_dz21 = Pfz.x + ji*oz21;
		vec3_dx22 = Pfx + ji*ox22;
		vec3_dy22 = Pfy.y + ji*oy22;
		vec3_dz22 = Pfz.y + ji*oz22;
		vec3_dx23 = Pfx + ji*ox23;
		vec3_dy23 = Pfy.y + ji*oy23;
		vec3_dz23 = Pfz.z + ji*oz23;
		vec3_dx31 = Pfx + ji*ox31;
		vec3_dy31 = Pfy.z + ji*oy31;
		vec3_dz31 = Pfz.x + ji*oz31;
		vec3_dx32 = Pfx + ji*ox32;
		vec3_dy32 = Pfy.z + ji*oy32;
		vec3_dz32 = Pfz.y + ji*oz32;
		vec3_dx33 = Pfx + ji*ox33;
		vec3_dy33 = Pfy.z + ji*oy33;
		vec3_dz33 = Pfz.z + ji*oz33;

		vec3_d11 = dx11 * dx11 + dy11 * dy11 + dz11 * dz11;
		vec3_d12 = dx12 * dx12 + dy12 * dy12 + dz12 * dz12;
		vec3_d13 = dx13 * dx13 + dy13 * dy13 + dz13 * dz13;
		vec3_d21 = dx21 * dx21 + dy21 * dy21 + dz21 * dz21;
		vec3_d22 = dx22 * dx22 + dy22 * dy22 + dz22 * dz22;
		vec3_d23 = dx23 * dx23 + dy23 * dy23 + dz23 * dz23;
		vec3_d31 = dx31 * dx31 + dy31 * dy31 + dz31 * dz31;
		vec3_d32 = dx32 * dx32 + dy32 * dy32 + dz32 * dz32;
		vec3_d33 = dx33 * dx33 + dy33 * dy33 + dz33 * dz33;

		vec3_d1a = min(d11, d12);
		d12 = max(d11, d12);
		d11 = min(d1a, d13); // Smallest now not in d12 or d13
		d13 = max(d1a, d13);
		d12 = min(d12, d13); // 2nd smallest now not in d13
		vec3_d2a = min(d21, d22);
		d22 = max(d21, d22);
		d21 = min(d2a, d23); // Smallest now not in d22 or d23
		d23 = max(d2a, d23);
		d22 = min(d22, d23); // 2nd smallest now not in d23
		vec3_d3a = min(d31, d32);
		d32 = max(d31, d32);
		d31 = min(d3a, d33); // Smallest now not in d32 or d33
		d33 = max(d3a, d33);
		d32 = min(d32, d33); // 2nd smallest now not in d33
		vec3_da = min(d11, d21);
		d21 = max(d11, d21);
		d11 = min(da, d31); // Smallest now in d11
		d31 = max(da, d31); // 2nd smallest now not in d31
		d11.xy = (d11.x < d11.y) ? d11.xy : d11.yx;
		d11.xz = (d11.x < d11.z) ? d11.xz : d11.zx; // d11.x now smallest
		d12 = min(d12, d21); // 2nd smallest now not in d21
		d12 = min(d12, d22); // nor in d22
		d12 = min(d12, d31); // nor in d31
		d12 = min(d12, d32); // nor in d32
		d11.yz = min(d11.yz,d12.xy); // nor in d12.yz
		d11.y = min(d11.y,d12.z); // Only two more to go
		d11.y = min(d11.y,d11.z); // Done! (Phew!)
		return_vec2(sqrt(d11.xy)); // F1, F2
	}

	return e
})
