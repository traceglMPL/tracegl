// | Acorn.js tools |____________________________/
// |
// | (C) Mozilla Corp
// | licensed under MPL 2.0 http://www.mozilla.org/MPL/
// \____________________________________________/

define(function(require, exports, module){
  "no tracegl"

	var acorn = require('./acorn')

	exports.dump = function(o, t, r){
		t = t || ''
		var a = Array.isArray(o)
		var s = (a?'[':'{')
		for(var k in o)if(o.hasOwnProperty(k)){

			if(k == 'parent' || k == 'tokens' || k=='start' || k=='end' || k=='token' || k=='loc') continue
			if(k == 'token'){
				s += '\n'+t+'token: '+o[k].t
				continue
			}
			var v = o[k]
			s += '\n' + t + k+': '
			if(typeof v == 'object') {
				s += exports.dump(v, t + ' ', r)
			}
			else s += v
		}
		s += '\n'+t.slice(1) + (a?']':'}')
		return s
	}

	//
	// AST walker
	//

	var walk = {
		Literal:              {}, // 1 single node
		Identifier:           {}, // 2 array of nodes
		Program:              {body:2}, // 3 keyss structure
		ExpressionStatement:  {expression:1}, // 4 value endpoint
		BreakStatement:       {},
		ContinueStatement:    {},
		DebuggerStatement:    {},
		DoWhileStatement:     {body:1, test:1},
		ReturnStatement:      {argument:1},
		SwitchStatement:      {discriminant:1,cases:2},
		SwitchCase:           {consequent:2,test:1},
		WhileStatement:       {test:1, body:1},
		WithStatement:        {object:1,body:1},
		EmptyStatement:       {},
		LabeledStatement:     {body:1,label:4},
		BlockStatement:       {body:2},
		ForStatement:         {init:1,test:1,update:1,body:1},
		ForInStatement:       {left:1,right:1,body:1},
		VariableDeclaration:  {declarations:2},
		VariableDeclarator:   {id:4,init:1},
		SequenceExpression:   {expressions:2},
		AssignmentExpression: {left:1,right:1},
		ConditionalExpression:{test:1,consequent:1,alternate:1},
		LogicalExpression:    {left:1,right:1},
		BinaryExpression:     {left:1,right:1},
		UpdateExpression:     {argument:1},
		UnaryExpression:      {argument:1},
		CallExpression:       {callee:1,arguments:2},
		ThisExpression:       {},
		ArrayExpression:      {elements:2},
		NewExpression:        {callee:1,arguments:2},
		FunctionDeclaration:  {id:4,params:2,body:1},
		FunctionExpression:   {id:4,params:2,body:1},
		ObjectExpression:     {properties:3},
		MemberExpression:     {object:1,property:1},
		IfStatement:          {test:1,consequent:1,alternate:1},
		ThrowStatement:       {argument:1},
		TryStatement:         {block:1,handlers:2,finalizer:1},
		CatchClause:          {param:1,guard:1,body:1}
	}

	function walkDown(n, o, p, k){
		if(!n) return
		var f = o[n.type]
		if(f){
			if(f(n, p)) return
		}
		var w = walk[n.type]
		for(var k in w){
			var t = w[k] // type
			var m = n[k] // node prop
			if(t == 2){ // array
				if(!Array.isArray(m))throw new Error("invalid type")
				for(var i = 0; i < m.length; i++){
					walkDown(m[i], o, {up:p, sub:k, type:n.type, node:n, index:i} )
				}
			} else if(t == 3){ // keys
				if(!Array.isArray(m))throw new Error("invalid type")
				for(var i = 0; i < m.length; i++){
					walkDown(m[i].value, o, {up:p, sub:k, type:n.type, node:n, index:i, key:m[i].key} )
				}
			} else { // single  node or value
				if(m) walkDown(m, o, {up:p, sub:k, type:n.type, node:n})
			}
		}
	}

	function walkUp(p, o){
		while(p){
			var f = o[p.node.type]
			if(f && f(p.node, p)) break
			p = p.up
		}
	}
	exports.walkDown = walkDown
	exports.walkUp = walkUp

	//
	// AST serializer
	//

	var sSep

	function sExp(e){
		if(!e || !e.type) return ''
		return sTab[e.type](e)
	}

	function sBlk(b){
		var s = ''
		for(var i = 0;i<b.length;i++)	s += sExp(b[i]) + sSep
		return s
	}

	function sSeq(b){
		var s = ''
		for(var i = 0;i<b.length;i++){
			if(i) s += ', '
			s += sExp(b[i])
		}
		return s
	}

	var sTab = {
		Literal:              function(n){ return n.raw },
		Identifier:           function(n){ return n.name },
		Program:              function(n){ return sBlk(n.body) },
		ExpressionStatement:  function(n){ return sExp(n.expression) },
		BreakStatement:       function(n){ return 'break' },
		ContinueStatement:    function(n){ return 'continue' },
		DebuggerStatement:    function(n){ return 'debugger' },
		DoWhileStatement:     function(n){ return 'do'+sExp(n.body)+sSep+'while('+sExp(n.test)+')' },
		ReturnStatement:      function(n){ return 'return '+sExp(n.argument) },
		SwitchStatement:      function(n){ return 'switch('+sExp(n.discriminant)+'){'+sBlk(n.cases)+'}' },
		SwitchCase:           function(n){ return 'case '+sExp(n.test)+':'+sSep+sBlk(n.consequent) },	
		WhileStatement:       function(n){ return 'while('+sExp(n.test)+')'+sExp(n.body) },
		WithStatement:        function(n){ return 'with('+sExp(n.object)+')'+sExp(n.body) },
		EmptyStatement:       function(n){ return '' },
		LabeledStatement:     function(n){ return sExp(n.label) + ':' + sSep + sExp(n.body) },
		BlockStatement:       function(n){ return '{'+sSep+sBlk(n.body)+'}' },
		ForStatement:         function(n){ return 'for('+sExp(n.init)+';'+sExp(n.test)+';'+sExp(n.update)+')'+sExp(n.body) },
		ForInStatement:       function(n){ return 'for('+sExp(n.left)+' in '+sExp(n.right)+')'+sExp(n.body) },		
		VariableDeclarator:   function(n){ return sExp(n.id)+' = ' +sExp(n.init) },
		VariableDeclaration:  function(n){ return 'var '+sSeq(n.declarations) },
		SequenceExpression:   function(n){ return sSeq(n.expressions) },
		AssignmentExpression: function(n){ return sExp(n.left)+n.operator+sExp(n.right) },
		ConditionalExpression:function(n){ return sExp(n.test)+'?'+sExp(n.consequent)+':'+sExp(n.alternate) },
		LogicalExpression:    function(n){ return sExp(n.left)+n.operator+sExp(n.right) },
		BinaryExpression:     function(n){ return sExp(n.left)+n.operator+sExp(n.right) },
		UpdateExpression:     function(n){ return n.prefix?n.operator+sExp(n.argument):sExp(n.argument)+n.operator },
		UnaryExpression:      function(n){ return n.prefix?n.operator+sExp(n.argument):sExp(n.argument)+n.operator },
		CallExpression:       function(n){ return sExp(n.callee)+'('+sSeq(n.arguments)+')' },
		ThisExpression:       function(n){ return 'this' },
		ArrayExpression:      function(n){ return '['+sSeq(n.elements)+']' },
		NewExpression:        function(n){ return 'new '+sExp(n.callee)+'('+sSeq(n.arguments)+')' },
		FunctionDeclaration:  function(n){ return 'function'+(n.id?' '+sExp(n.id):'')+'('+sSeq(n.params)+')'+sExp(n.body) },
		FunctionExpression:   function(n){ return 'function'+(n.id?' '+sExp(n.id):'')+'('+sSeq(n.params)+')'+sExp(n.body) },
		ObjectExpression:     function(n){
			var s = '{'
			var b = n.properties
			for(var i = 0;i<b.length;i++){
				if(i) s += ', '
				s += sExp(b.key) + ':' + sExp(b.value)
			}
			s += '}'
			return s
		},
		MemberExpression:     function(n){
			if(n.computed)	return sExp(n.object)+'['+sExp(n.property)+']'
			return sExp(n.object)+'.'+sExp(n.property)
		},
		IfStatement:          function(n){ 
			return 'if('+sExp(n.test)+')' + sExp(n.consequent) + sSep +
			       (n.alternate ? 'else ' + sExp(n.alternate) + sSep : '') 
		},
		ThrowStatement:       function(n){ return 'throw '+sExp(n.argument) },
		TryStatement:         function(n){ 
			return 'try '+sExp(n.block)+sSep+sBlk(n.handlers)+sSep+
			       (n.finalizer? 'finally ' + sBlk(n.finalizer) : '')
		},
		CatchClause:          function(n){
			return 'catch(' + sExp(n.param) + (n.guard?' if '+sExp(n.guard):')') + sExp(n.body)
		}
	}

	function stringify(n, sep){
		sSep = sep || '\n'
		return sExp(n)
	}

	exports.stringify = stringify

	var types = acorn.tokTypes

	function nodeProto(p){

		// property getter type checking
		for(var k in types){
			(function(k){
				p.__defineGetter__(k, function(){
					return this._t == types[k]
				})
			})(k)
		}
		// other types
		p.__defineGetter__('isAssign', function(){ return this._t && this._t.isAssign })
		p.__defineGetter__('isLoop', function(){ return this._t && this._t.isLoop })
		p.__defineGetter__('prefix', function(){ return this._t && this._t.prefix })
		p.__defineGetter__('beforeExpr', function(){ return this._t && this._t.beforeExpr })
		p.__defineGetter__('beforeNewline', function(){ return this.w && this.w.match(/\n/) })
		p.__defineGetter__('beforeEnd', function(){ return this.w && this.w.match(/\n/) || this.d.semi || this.d.braceR })
		p.__defineGetter__('fnscope', function(){ return this.d.parenL ? this.d.d : this.d.d.d })
		p.__defineGetter__('last', function(){ var t = this; while(t._d) t = t._d; return t })
		p.__defineGetter__('astParent', function(){ var t = this; while(t._d) t = t._d; return t })
		
		// walker
		p.walk = function(cb){
			var n = this
			var p = n
			cb(n)
			n = n._c
			while(n && n != p){
				cb(n)
				if(n._c) n = n._c
				else while(n != p){ 
					if(n._d){ n = n._d; break } 
					n = n._p 
				}
			}
		}
	}

	function Node(){ }
	nodeProto(Node.prototype)

	// acorn parse wrapper that also spits out a token tree	
	exports.parse = function(inpt, opts) {
		var h = {
			finishToken:finishToken,
			initTokenState:initTokenState,
			tokTree:new Node()
		}
		h.tokTree.root = 1
		h.tokTree.t = h.tokTree.w = ''

		if(opts && opts.compact) h.compact = 1
		if(opts && opts.noclose) h.noclose = 1

		var n = acorn.parse(inpt, opts, h)
		n.tokens = h.tokTree
		return n
	}

	function initTokenState(hack, tokPos, input){
		if(tokPos != 0) hack.tokTree.w = input.slice(0, tokPos)
	}

	function finishToken(hack, type, val, input, tokStart, tokEnd, tokPos){	
		var tokTree = hack.tokTree
		var n
		if(type == types.eof) return
		if(type == types.regexp && tokTree._e && tokTree._e._t.binop == 10){
			// verify this one
			n = tokTree._e, tokStart -= 1 
		} else if(hack.compact && tokTree._e && (type == types.name && tokTree._e._t == types.dot || type == types.dot && tokTree._e._t == types.name)){
			n = tokTree._e
			n._t = type
			n.t += input.slice(tokStart, tokEnd)			
		} else {
			var n = new Node()
			var t = tokTree
			if(t){
				if(!t._c) t._e = t._c = n
				else t._e._d = n, n._u = t._e, t._e = n
			}
			n._p = t
			n._t = type
			n.t = input.slice(tokStart, tokEnd)
		}

		if(tokEnd != tokPos) n.w = input.slice(tokEnd, tokPos)
		else n.w = ''

		if(type == types.braceL || type == types.bracketL || type == types.parenL){
			tokTree = n
		} 
		else if(type == types.braceR || type == types.bracketR || type == types.parenR){
			if(hack.noclose){
				if(!tokTree._e._u) delete tokTree._c, delete tokTree._e
				else delete tokTree._e._u._d
			}
			if(tokTree._p)
			 	tokTree = tokTree._p
		} 
		hack.tokTree = tokTree
	}
})
