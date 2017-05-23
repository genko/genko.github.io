require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"iota-compiler":[function(require,module,exports){
module.exports=require('GVqErh');
},{}],"GVqErh":[function(require,module,exports){

var compile = require('./src/compile');
var lib = require('./src/lib');
var _io = lib;

function compileCode(input, options) {
	options = options || {};
	compile.setOptions(options);
	var result = compile.compile(input);
	return result.trim();
}

function parse(input, options) {
	options = options || {};
	compile.setOptions(options);
	return compile.parse(input);
}

function evaluate (code) {
	if (code === '') return null;
	var context = {};
	eval(compileCode(code, {
		wrapWithFunction: true,
		functionName: 'context.run'
	}));
	return context.run();
}

module.exports = {
	compile: compileCode,
	parse: parse,
	lib: lib,
	eval: evaluate,
};

},{"./src/compile":52,"./src/lib":53}],3:[function(require,module,exports){
(function (process,__filename){
/** vim: et:ts=4:sw=4:sts=4
 * @license amdefine 1.0.1 Copyright (c) 2011-2016, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/amdefine for details
 */

/*jslint node: true */
/*global module, process */
'use strict';

/**
 * Creates a define for node.
 * @param {Object} module the "module" object that is defined by Node for the
 * current module.
 * @param {Function} [requireFn]. Node's require function for the current module.
 * It only needs to be passed in Node versions before 0.5, when module.require
 * did not exist.
 * @returns {Function} a define function that is usable for the current node
 * module.
 */
function amdefine(module, requireFn) {
    'use strict';
    var defineCache = {},
        loaderCache = {},
        alreadyCalled = false,
        path = require('path'),
        makeRequire, stringRequire;

    /**
     * Trims the . and .. from an array of path segments.
     * It will keep a leading path segment if a .. will become
     * the first path segment, to help with module name lookups,
     * which act like paths, but can be remapped. But the end result,
     * all paths that use this function should look normalized.
     * NOTE: this method MODIFIES the input array.
     * @param {Array} ary the array of path segments.
     */
    function trimDots(ary) {
        var i, part;
        for (i = 0; ary[i]; i+= 1) {
            part = ary[i];
            if (part === '.') {
                ary.splice(i, 1);
                i -= 1;
            } else if (part === '..') {
                if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                    //End of the line. Keep at least one non-dot
                    //path segment at the front so it can be mapped
                    //correctly to disk. Otherwise, there is likely
                    //no path mapping for a path starting with '..'.
                    //This can still fail, but catches the most reasonable
                    //uses of ..
                    break;
                } else if (i > 0) {
                    ary.splice(i - 1, 2);
                    i -= 2;
                }
            }
        }
    }

    function normalize(name, baseName) {
        var baseParts;

        //Adjust any relative paths.
        if (name && name.charAt(0) === '.') {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                baseParts = baseName.split('/');
                baseParts = baseParts.slice(0, baseParts.length - 1);
                baseParts = baseParts.concat(name.split('/'));
                trimDots(baseParts);
                name = baseParts.join('/');
            }
        }

        return name;
    }

    /**
     * Create the normalize() function passed to a loader plugin's
     * normalize method.
     */
    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(id) {
        function load(value) {
            loaderCache[id] = value;
        }

        load.fromText = function (id, text) {
            //This one is difficult because the text can/probably uses
            //define, and any relative paths and requires should be relative
            //to that id was it would be found on disk. But this would require
            //bootstrapping a module/require fairly deeply from node core.
            //Not sure how best to go about that yet.
            throw new Error('amdefine does not implement load.fromText');
        };

        return load;
    }

    makeRequire = function (systemRequire, exports, module, relId) {
        function amdRequire(deps, callback) {
            if (typeof deps === 'string') {
                //Synchronous, single module require('')
                return stringRequire(systemRequire, exports, module, deps, relId);
            } else {
                //Array of dependencies with a callback.

                //Convert the dependencies to modules.
                deps = deps.map(function (depName) {
                    return stringRequire(systemRequire, exports, module, depName, relId);
                });

                //Wait for next tick to call back the require call.
                if (callback) {
                    process.nextTick(function () {
                        callback.apply(null, deps);
                    });
                }
            }
        }

        amdRequire.toUrl = function (filePath) {
            if (filePath.indexOf('.') === 0) {
                return normalize(filePath, path.dirname(module.filename));
            } else {
                return filePath;
            }
        };

        return amdRequire;
    };

    //Favor explicit value, passed in if the module wants to support Node 0.4.
    requireFn = requireFn || function req() {
        return module.require.apply(module, arguments);
    };

    function runFactory(id, deps, factory) {
        var r, e, m, result;

        if (id) {
            e = loaderCache[id] = {};
            m = {
                id: id,
                uri: __filename,
                exports: e
            };
            r = makeRequire(requireFn, e, m, id);
        } else {
            //Only support one define call per file
            if (alreadyCalled) {
                throw new Error('amdefine with no module ID cannot be called more than once per file.');
            }
            alreadyCalled = true;

            //Use the real variables from node
            //Use module.exports for exports, since
            //the exports in here is amdefine exports.
            e = module.exports;
            m = module;
            r = makeRequire(requireFn, e, m, module.id);
        }

        //If there are dependencies, they are strings, so need
        //to convert them to dependency values.
        if (deps) {
            deps = deps.map(function (depName) {
                return r(depName);
            });
        }

        //Call the factory with the right dependencies.
        if (typeof factory === 'function') {
            result = factory.apply(m.exports, deps);
        } else {
            result = factory;
        }

        if (result !== undefined) {
            m.exports = result;
            if (id) {
                loaderCache[id] = m.exports;
            }
        }
    }

    stringRequire = function (systemRequire, exports, module, id, relId) {
        //Split the ID by a ! so that
        var index = id.indexOf('!'),
            originalId = id,
            prefix, plugin;

        if (index === -1) {
            id = normalize(id, relId);

            //Straight module lookup. If it is one of the special dependencies,
            //deal with it, otherwise, delegate to node.
            if (id === 'require') {
                return makeRequire(systemRequire, exports, module, relId);
            } else if (id === 'exports') {
                return exports;
            } else if (id === 'module') {
                return module;
            } else if (loaderCache.hasOwnProperty(id)) {
                return loaderCache[id];
            } else if (defineCache[id]) {
                runFactory.apply(null, defineCache[id]);
                return loaderCache[id];
            } else {
                if(systemRequire) {
                    return systemRequire(originalId);
                } else {
                    throw new Error('No module with ID: ' + id);
                }
            }
        } else {
            //There is a plugin in play.
            prefix = id.substring(0, index);
            id = id.substring(index + 1, id.length);

            plugin = stringRequire(systemRequire, exports, module, prefix, relId);

            if (plugin.normalize) {
                id = plugin.normalize(id, makeNormalize(relId));
            } else {
                //Normalize the ID normally.
                id = normalize(id, relId);
            }

            if (loaderCache[id]) {
                return loaderCache[id];
            } else {
                plugin.load(id, makeRequire(systemRequire, exports, module, relId), makeLoad(id), {});

                return loaderCache[id];
            }
        }
    };

    //Create a define function specific to the module asking for amdefine.
    function define(id, deps, factory) {
        if (Array.isArray(id)) {
            factory = deps;
            deps = id;
            id = undefined;
        } else if (typeof id !== 'string') {
            factory = id;
            id = deps = undefined;
        }

        if (deps && !Array.isArray(deps)) {
            factory = deps;
            deps = undefined;
        }

        if (!deps) {
            deps = ['require', 'exports', 'module'];
        }

        //Set up properties for this module. If an ID, then use
        //internal cache. If no ID, then use the external variables
        //for this node module.
        if (id) {
            //Put the module in deep freeze until there is a
            //require call for it.
            defineCache[id] = [id, deps, factory];
        } else {
            runFactory(id, deps, factory);
        }
    }

    //define.require, which has access to all the values in the
    //cache. Useful for AMD modules that all have IDs in the file,
    //but need to finally export a value to node based on one of those
    //IDs.
    define.require = function (id) {
        if (loaderCache[id]) {
            return loaderCache[id];
        }

        if (defineCache[id]) {
            runFactory.apply(null, defineCache[id]);
            return loaderCache[id];
        }
    };

    define.amd = {};

    return define;
}

module.exports = amdefine;

}).call(this,require("g5I+bs"),"/node_modules/amdefine/amdefine.js")
},{"g5I+bs":37,"path":36}],4:[function(require,module,exports){
// http://wiki.commonjs.org/wiki/Unit_Testing/1.0
//
// THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
//
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// when used in node, this will actually load the util module we depend on
// versus loading the builtin util module as happens otherwise
// this is a bug in node module loading as far as I am concerned
var util = require('util/');

var pSlice = Array.prototype.slice;
var hasOwn = Object.prototype.hasOwnProperty;

// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  if (options.message) {
    this.message = options.message;
    this.generatedMessage = false;
  } else {
    this.message = getMessage(this);
    this.generatedMessage = true;
  }
  var stackStartFunction = options.stackStartFunction || fail;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  }
  else {
    // non v8 browsers so we can have a stacktrace
    var err = new Error();
    if (err.stack) {
      var out = err.stack;

      // try to strip useless frames
      var fn_name = stackStartFunction.name;
      var idx = out.indexOf('\n' + fn_name);
      if (idx >= 0) {
        // once we have located the function frame
        // we need to strip out everything before it (and its line)
        var next_line = out.indexOf('\n', idx + 1);
        out = out.substring(next_line + 1);
      }

      this.stack = out;
    }
  }
};

// assert.AssertionError instanceof Error
util.inherits(assert.AssertionError, Error);

function replacer(key, value) {
  if (util.isUndefined(value)) {
    return '' + value;
  }
  if (util.isNumber(value) && (isNaN(value) || !isFinite(value))) {
    return value.toString();
  }
  if (util.isFunction(value) || util.isRegExp(value)) {
    return value.toString();
  }
  return value;
}

function truncate(s, n) {
  if (util.isString(s)) {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}

function getMessage(self) {
  return truncate(JSON.stringify(self.actual, replacer), 128) + ' ' +
         self.operator + ' ' +
         truncate(JSON.stringify(self.expected, replacer), 128);
}

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, !!guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

function _deepEqual(actual, expected) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;

  } else if (util.isBuffer(actual) && util.isBuffer(expected)) {
    if (actual.length != expected.length) return false;

    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }

    return true;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (util.isDate(actual) && util.isDate(expected)) {
    return actual.getTime() === expected.getTime();

  // 7.3 If the expected value is a RegExp object, the actual value is
  // equivalent if it is also a RegExp object with the same source and
  // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
  } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
    return actual.source === expected.source &&
           actual.global === expected.global &&
           actual.multiline === expected.multiline &&
           actual.lastIndex === expected.lastIndex &&
           actual.ignoreCase === expected.ignoreCase;

  // 7.4. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if (!util.isObject(actual) && !util.isObject(expected)) {
    return actual == expected;

  // 7.5 For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else {
    return objEquiv(actual, expected);
  }
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b) {
  if (util.isNullOrUndefined(a) || util.isNullOrUndefined(b))
    return false;
  // an identical 'prototype' property.
  if (a.prototype !== b.prototype) return false;
  //~~~I've managed to break Object.keys through screwy arguments passing.
  //   Converting to array solves the problem.
  if (isArguments(a)) {
    if (!isArguments(b)) {
      return false;
    }
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b);
  }
  try {
    var ka = objectKeys(a),
        kb = objectKeys(b),
        key, i;
  } catch (e) {//happens when one is a string literal and the other isn't
    return false;
  }
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length != kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] != kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (Object.prototype.toString.call(expected) == '[object RegExp]') {
    return expected.test(actual);
  } else if (actual instanceof expected) {
    return true;
  } else if (expected.call({}, actual) === true) {
    return true;
  }

  return false;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (util.isString(expected)) {
    message = expected;
    expected = null;
  }

  try {
    block();
  } catch (e) {
    actual = e;
  }

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail(actual, expected, 'Missing expected exception' + message);
  }

  if (!shouldThrow && expectedException(actual, expected)) {
    fail(actual, expected, 'Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws.apply(this, [true].concat(pSlice.call(arguments)));
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/message) {
  _throws.apply(this, [false].concat(pSlice.call(arguments)));
};

assert.ifError = function(err) { if (err) {throw err;}};

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    if (hasOwn.call(obj, key)) keys.push(key);
  }
  return keys;
};

},{"util/":50}],5:[function(require,module,exports){
var types = require("../lib/types");
var Type = types.Type;
var def = Type.def;
var or = Type.or;
var builtin = types.builtInTypes;
var isString = builtin.string;
var isNumber = builtin.number;
var isBoolean = builtin.boolean;
var isRegExp = builtin.RegExp;
var shared = require("../lib/shared");
var defaults = shared.defaults;
var geq = shared.geq;

def("Node")
    .field("type", isString)
    .field("loc", or(
        def("SourceLocation"),
        null
    ), defaults["null"], true);

def("SourceLocation")
    .build("start", "end", "source")
    .field("start", def("Position"))
    .field("end", def("Position"))
    .field("source", or(isString, null), defaults["null"]);

def("Position")
    .build("line", "column")
    .field("line", geq(1))
    .field("column", geq(0));

def("Program")
    .bases("Node")
    .build("body")
    .field("body", [def("Statement")]);

def("Function")
    .bases("Node")
    .field("id", or(def("Identifier"), null), defaults["null"])
    .field("params", [def("Pattern")])
    .field("body", or(def("BlockStatement"), def("Expression")));

def("Statement").bases("Node");

// The empty .build() here means that an EmptyStatement can be constructed
// (i.e. it's not abstract) but that it needs no arguments.
def("EmptyStatement").bases("Statement").build();

def("BlockStatement")
    .bases("Statement")
    .build("body")
    .field("body", [def("Statement")]);

// TODO Figure out how to silently coerce Expressions to
// ExpressionStatements where a Statement was expected.
def("ExpressionStatement")
    .bases("Statement")
    .build("expression")
    .field("expression", def("Expression"));

def("IfStatement")
    .bases("Statement")
    .build("test", "consequent", "alternate")
    .field("test", def("Expression"))
    .field("consequent", def("Statement"))
    .field("alternate", or(def("Statement"), null), defaults["null"]);

def("LabeledStatement")
    .bases("Statement")
    .build("label", "body")
    .field("label", def("Identifier"))
    .field("body", def("Statement"));

def("BreakStatement")
    .bases("Statement")
    .build("label")
    .field("label", or(def("Identifier"), null), defaults["null"]);

def("ContinueStatement")
    .bases("Statement")
    .build("label")
    .field("label", or(def("Identifier"), null), defaults["null"]);

def("WithStatement")
    .bases("Statement")
    .build("object", "body")
    .field("object", def("Expression"))
    .field("body", def("Statement"));

def("SwitchStatement")
    .bases("Statement")
    .build("discriminant", "cases", "lexical")
    .field("discriminant", def("Expression"))
    .field("cases", [def("SwitchCase")])
    .field("lexical", isBoolean, defaults["false"]);

def("ReturnStatement")
    .bases("Statement")
    .build("argument")
    .field("argument", or(def("Expression"), null));

def("ThrowStatement")
    .bases("Statement")
    .build("argument")
    .field("argument", def("Expression"));

def("TryStatement")
    .bases("Statement")
    .build("block", "handler", "finalizer")
    .field("block", def("BlockStatement"))
    .field("handler", or(def("CatchClause"), null), function() {
        return this.handlers && this.handlers[0] || null;
    })
    .field("handlers", [def("CatchClause")], function() {
        return this.handler ? [this.handler] : [];
    }, true) // Indicates this field is hidden from eachField iteration.
    .field("guardedHandlers", [def("CatchClause")], defaults.emptyArray)
    .field("finalizer", or(def("BlockStatement"), null), defaults["null"]);

def("CatchClause")
    .bases("Node")
    .build("param", "guard", "body")
    .field("param", def("Pattern"))
    .field("guard", or(def("Expression"), null), defaults["null"])
    .field("body", def("BlockStatement"));

def("WhileStatement")
    .bases("Statement")
    .build("test", "body")
    .field("test", def("Expression"))
    .field("body", def("Statement"));

def("DoWhileStatement")
    .bases("Statement")
    .build("body", "test")
    .field("body", def("Statement"))
    .field("test", def("Expression"));

def("ForStatement")
    .bases("Statement")
    .build("init", "test", "update", "body")
    .field("init", or(
        def("VariableDeclaration"),
        def("Expression"),
        null))
    .field("test", or(def("Expression"), null))
    .field("update", or(def("Expression"), null))
    .field("body", def("Statement"));

def("ForInStatement")
    .bases("Statement")
    .build("left", "right", "body", "each")
    .field("left", or(
        def("VariableDeclaration"),
        def("Expression")))
    .field("right", def("Expression"))
    .field("body", def("Statement"))
    .field("each", isBoolean);

def("DebuggerStatement").bases("Statement").build();

def("Declaration").bases("Statement");

def("FunctionDeclaration")
    .bases("Function", "Declaration")
    .build("id", "params", "body")
    .field("id", def("Identifier"));

def("FunctionExpression")
    .bases("Function", "Expression")
    .build("id", "params", "body");

def("VariableDeclaration")
    .bases("Declaration")
    .build("kind", "declarations")
    .field("kind", or("var", "let", "const"))
    .field("declarations", [or(
        def("VariableDeclarator"),
        def("Identifier") // TODO Esprima deviation.
    )]);

def("VariableDeclarator")
    .bases("Node")
    .build("id", "init")
    .field("id", def("Pattern"))
    .field("init", or(def("Expression"), null));

// TODO Are all Expressions really Patterns?
def("Expression").bases("Node", "Pattern");

def("ThisExpression").bases("Expression").build();

def("ArrayExpression")
    .bases("Expression")
    .build("elements")
    .field("elements", [or(def("Expression"), null)]);

def("ObjectExpression")
    .bases("Expression")
    .build("properties")
    .field("properties", [def("Property")]);

// TODO Not in the Mozilla Parser API, but used by Esprima.
def("Property")
    .bases("Node") // Want to be able to visit Property Nodes.
    .build("kind", "key", "value")
    .field("kind", or("init", "get", "set"))
    .field("key", or(def("Literal"), def("Identifier")))
    .field("value", def("Expression"));

def("SequenceExpression")
    .bases("Expression")
    .build("expressions")
    .field("expressions", [def("Expression")]);

var UnaryOperator = or(
    "-", "+", "!", "~",
    "typeof", "void", "delete");

def("UnaryExpression")
    .bases("Expression")
    .build("operator", "argument", "prefix")
    .field("operator", UnaryOperator)
    .field("argument", def("Expression"))
    // TODO Esprima doesn't bother with this field, presumably because
    // it's always true for unary operators.
    .field("prefix", isBoolean, defaults["true"]);

var BinaryOperator = or(
    "==", "!=", "===", "!==",
    "<", "<=", ">", ">=",
    "<<", ">>", ">>>",
    "+", "-", "*", "/", "%",
    "&", // TODO Missing from the Parser API.
    "|", "^", "in",
    "instanceof", "..");

def("BinaryExpression")
    .bases("Expression")
    .build("operator", "left", "right")
    .field("operator", BinaryOperator)
    .field("left", def("Expression"))
    .field("right", def("Expression"));

var AssignmentOperator = or(
    "=", "+=", "-=", "*=", "/=", "%=",
    "<<=", ">>=", ">>>=",
    "|=", "^=", "&=");

def("AssignmentExpression")
    .bases("Expression")
    .build("operator", "left", "right")
    .field("operator", AssignmentOperator)
    .field("left", def("Pattern"))
    .field("right", def("Expression"));

var UpdateOperator = or("++", "--");

def("UpdateExpression")
    .bases("Expression")
    .build("operator", "argument", "prefix")
    .field("operator", UpdateOperator)
    .field("argument", def("Expression"))
    .field("prefix", isBoolean);

var LogicalOperator = or("||", "&&");

def("LogicalExpression")
    .bases("Expression")
    .build("operator", "left", "right")
    .field("operator", LogicalOperator)
    .field("left", def("Expression"))
    .field("right", def("Expression"));

def("ConditionalExpression")
    .bases("Expression")
    .build("test", "consequent", "alternate")
    .field("test", def("Expression"))
    .field("consequent", def("Expression"))
    .field("alternate", def("Expression"));

def("NewExpression")
    .bases("Expression")
    .build("callee", "arguments")
    .field("callee", def("Expression"))
    // The Mozilla Parser API gives this type as [or(def("Expression"),
    // null)], but null values don't really make sense at the call site.
    // TODO Report this nonsense.
    .field("arguments", [def("Expression")]);

def("CallExpression")
    .bases("Expression")
    .build("callee", "arguments")
    .field("callee", def("Expression"))
    // See comment for NewExpression above.
    .field("arguments", [def("Expression")]);

def("MemberExpression")
    .bases("Expression")
    .build("object", "property", "computed")
    .field("object", def("Expression"))
    .field("property", or(def("Identifier"), def("Expression")))
    .field("computed", isBoolean);

def("Pattern").bases("Node");

def("ObjectPattern")
    .bases("Pattern")
    .build("properties")
    // TODO File a bug to get PropertyPattern added to the interfaces API.
    .field("properties", [def("PropertyPattern")]);

def("PropertyPattern")
    .bases("Pattern")
    .build("key", "pattern")
    .field("key", or(def("Literal"), def("Identifier")))
    .field("pattern", def("Pattern"));

def("ArrayPattern")
    .bases("Pattern")
    .build("elements")
    .field("elements", [or(def("Pattern"), null)]);

def("SwitchCase")
    .bases("Node")
    .build("test", "consequent")
    .field("test", or(def("Expression"), null))
    .field("consequent", [def("Statement")]);

def("Identifier")
    // But aren't Expressions and Patterns already Nodes? TODO Report this.
    .bases("Node", "Expression", "Pattern")
    .build("name")
    .field("name", isString);

def("Literal")
    // But aren't Expressions already Nodes? TODO Report this.
    .bases("Node", "Expression")
    .build("value")
    .field("value", or(
        isString,
        isBoolean,
        null, // isNull would also work here.
        isNumber,
        isRegExp
    ));

},{"../lib/shared":16,"../lib/types":18}],6:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var builtin = types.builtInTypes;
var isString = builtin.string;
var isBoolean = builtin.boolean;

// Note that none of these types are buildable because the Mozilla Parser
// API doesn't specify any builder functions, and nobody uses E4X anymore.

def("XMLDefaultDeclaration")
    .bases("Declaration")
    .field("namespace", def("Expression"));

def("XMLAnyName").bases("Expression");

def("XMLQualifiedIdentifier")
    .bases("Expression")
    .field("left", or(def("Identifier"), def("XMLAnyName")))
    .field("right", or(def("Identifier"), def("Expression")))
    .field("computed", isBoolean);

def("XMLFunctionQualifiedIdentifier")
    .bases("Expression")
    .field("right", or(def("Identifier"), def("Expression")))
    .field("computed", isBoolean);

def("XMLAttributeSelector")
    .bases("Expression")
    .field("attribute", def("Expression"));

def("XMLFilterExpression")
    .bases("Expression")
    .field("left", def("Expression"))
    .field("right", def("Expression"));

def("XMLElement")
    .bases("XML", "Expression")
    .field("contents", [def("XML")]);

def("XMLList")
    .bases("XML", "Expression")
    .field("contents", [def("XML")]);

def("XML").bases("Node");

def("XMLEscape")
    .bases("XML")
    .field("expression", def("Expression"));

def("XMLText")
    .bases("XML")
    .field("text", isString);

def("XMLStartTag")
    .bases("XML")
    .field("contents", [def("XML")]);

def("XMLEndTag")
    .bases("XML")
    .field("contents", [def("XML")]);

def("XMLPointTag")
    .bases("XML")
    .field("contents", [def("XML")]);

def("XMLName")
    .bases("XML")
    .field("contents", or(isString, [def("XML")]));

def("XMLAttribute")
    .bases("XML")
    .field("value", isString);

def("XMLCdata")
    .bases("XML")
    .field("contents", isString);

def("XMLComment")
    .bases("XML")
    .field("contents", isString);

def("XMLProcessingInstruction")
    .bases("XML")
    .field("target", isString)
    .field("contents", or(isString, null));

},{"../lib/types":18,"./core":5}],7:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var builtin = types.builtInTypes;
var isBoolean = builtin.boolean;
var isObject = builtin.object;
var isString = builtin.string;
var defaults = require("../lib/shared").defaults;

def("Function")
    .field("generator", isBoolean, defaults["false"])
    .field("expression", isBoolean, defaults["false"])
    .field("defaults", [or(def("Expression"), null)], defaults.emptyArray)
    // TODO This could be represented as a SpreadElementPattern in .params.
    .field("rest", or(def("Identifier"), null), defaults["null"]);

def("FunctionDeclaration")
    .build("id", "params", "body", "generator", "expression");

def("FunctionExpression")
    .build("id", "params", "body", "generator", "expression");

// TODO The Parser API calls this ArrowExpression, but Esprima uses
// ArrowFunctionExpression.
def("ArrowFunctionExpression")
    .bases("Function", "Expression")
    .build("params", "body", "expression")
    // The forced null value here is compatible with the overridden
    // definition of the "id" field in the Function interface.
    .field("id", null, defaults["null"])
    // The current spec forbids arrow generators, so I have taken the
    // liberty of enforcing that. TODO Report this.
    .field("generator", false);

def("YieldExpression")
    .bases("Expression")
    .build("argument", "delegate")
    .field("argument", or(def("Expression"), null))
    .field("delegate", isBoolean, defaults["false"]);

def("GeneratorExpression")
    .bases("Expression")
    .build("body", "blocks", "filter")
    .field("body", def("Expression"))
    .field("blocks", [def("ComprehensionBlock")])
    .field("filter", or(def("Expression"), null));

def("ComprehensionExpression")
    .bases("Expression")
    .build("body", "blocks", "filter")
    .field("body", def("Expression"))
    .field("blocks", [def("ComprehensionBlock")])
    .field("filter", or(def("Expression"), null));

def("ComprehensionBlock")
    .bases("Node")
    .build("left", "right", "each")
    .field("left", def("Pattern"))
    .field("right", def("Expression"))
    .field("each", isBoolean);

// This would be the ideal definition for ModuleSpecifier, but alas we
// can't expect ASTs parsed by Esprima to use this custom subtype:
def("ModuleSpecifier")
    .bases("Specifier", "Literal")
//  .build("value") // Make it abstract/non-buildable for now.
    .field("value", isString);

// Instead we must settle for a cheap type alias:
var ModuleSpecifier = def("Literal");

def("ModuleDeclaration")
    .bases("Declaration")
    .build("id", "from", "body")
    .field("id", or(def("Literal"), def("Identifier")))
    .field("source", or(ModuleSpecifier, null))
    .field("body", or(def("BlockStatement"), null));

def("Property")
    // Esprima extensions not mentioned in the Mozilla Parser API:
    .field("method", isBoolean, defaults["false"])
    .field("shorthand", isBoolean, defaults["false"])
    .field("computed", isBoolean, defaults["false"]);

def("MethodDefinition")
    .bases("Declaration")
    .build("kind", "key", "value")
    .field("kind", or("init", "get", "set", ""))
    .field("key", or(def("Literal"), def("Identifier")))
    .field("value", def("Function"));

def("SpreadElement")
    .bases("Node")
    .build("argument")
    .field("argument", def("Expression"));

def("ArrayExpression")
    .field("elements", [or(def("Expression"), def("SpreadElement"), null)]);

def("NewExpression")
    .field("arguments", [or(def("Expression"), def("SpreadElement"))]);

def("CallExpression")
    .field("arguments", [or(def("Expression"), def("SpreadElement"))]);

def("SpreadElementPattern")
    .bases("Pattern")
    .build("argument")
    .field("argument", def("Pattern"));

var ClassBodyElement = or(
    def("MethodDefinition"),
    def("VariableDeclarator"),
    def("ClassPropertyDefinition"),
    def("ClassProperty")
);

def("ClassProperty")
  .bases("Declaration")
  .build("id")
  .field("id", def("Identifier"));

def("ClassPropertyDefinition") // static property
    .bases("Declaration")
    .build("definition")
    // Yes, Virginia, circular definitions are permitted.
    .field("definition", ClassBodyElement);

def("ClassBody")
    .bases("Declaration")
    .build("body")
    .field("body", [ClassBodyElement]);

def("ClassDeclaration")
    .bases("Declaration")
    .build("id", "body", "superClass")
    .field("id", def("Identifier"))
    .field("body", def("ClassBody"))
    .field("superClass", or(def("Expression"), null), defaults["null"]);

def("ClassExpression")
    .bases("Expression")
    .build("id", "body", "superClass")
    .field("id", or(def("Identifier"), null), defaults["null"])
    .field("body", def("ClassBody"))
    .field("superClass", or(def("Expression"), null), defaults["null"]);

// Specifier and NamedSpecifier are non-standard types that I introduced
// for definitional convenience.
def("Specifier").bases("Node");
def("NamedSpecifier")
    .bases("Specifier")
    .field("id", def("Identifier"))
    .field("name", or(def("Identifier"), null), defaults["null"]);

def("ExportSpecifier")
    .bases("NamedSpecifier")
    .build("id", "name");

def("ExportBatchSpecifier")
    .bases("Specifier")
    .build();

def("ImportSpecifier")
    .bases("NamedSpecifier")
    .build("id", "name");

def("ExportDeclaration")
    .bases("Declaration")
    .build("default", "declaration", "specifiers", "source")
    .field("default", isBoolean)
    .field("declaration", or(
        def("Declaration"),
        def("Expression") // Implies default.
    ))
    .field("specifiers", [or(
        def("ExportSpecifier"),
        def("ExportBatchSpecifier")
    )], defaults.emptyArray)
    .field("source", or(ModuleSpecifier, null), defaults["null"]);

def("ImportDeclaration")
    .bases("Declaration")
    .build("specifiers", "kind", "source")
    .field("specifiers", [def("ImportSpecifier")])
    .field("kind", or("named", "default", null))
    .field("source", ModuleSpecifier);

def("TaggedTemplateExpression")
    .bases("Expression")
    .field("tag", def("Expression"))
    .field("quasi", def("TemplateLiteral"));

def("TemplateLiteral")
    .bases("Expression")
    .build("quasis", "expressions")
    .field("quasis", [def("TemplateElement")])
    .field("expressions", [def("Expression")]);

def("TemplateElement")
    .bases("Node")
    .build("value", "tail")
    .field("value", {"cooked": isString, "raw": isString})
    .field("tail", isBoolean);

},{"../lib/shared":16,"../lib/types":18,"./core":5}],8:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var builtin = types.builtInTypes;
var isBoolean = builtin.boolean;
var defaults = require("../lib/shared").defaults;

def("Function")
    .field("async", isBoolean, defaults["false"]);

def("SpreadProperty")
    .bases("Node")
    .build("argument")
    .field("argument", def("Expression"));

def("ObjectExpression")
    .field("properties", [or(def("Property"), def("SpreadProperty"))]);

def("SpreadPropertyPattern")
    .bases("Pattern")
    .build("argument")
    .field("argument", def("Pattern"));

def("ObjectPattern")
    .field("properties", [or(
        def("PropertyPattern"),
        def("SpreadPropertyPattern")
    )]);

def("AwaitExpression")
    .bases("Expression")
    .build("argument", "all")
    .field("argument", or(def("Expression"), null))
    .field("all", isBoolean, defaults["false"]);

},{"../lib/shared":16,"../lib/types":18,"./core":5}],9:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var builtin = types.builtInTypes;
var isString = builtin.string;
var isBoolean = builtin.boolean;
var defaults = require("../lib/shared").defaults;

def("XJSAttribute")
    .bases("Node")
    .build("name", "value")
    .field("name", or(def("XJSIdentifier"), def("XJSNamespacedName")))
    .field("value", or(
        def("Literal"), // attr="value"
        def("XJSExpressionContainer"), // attr={value}
        null // attr= or just attr
    ), defaults["null"]);

def("XJSIdentifier")
    .bases("Node")
    .build("name")
    .field("name", isString);

def("XJSNamespacedName")
    .bases("Node")
    .build("namespace", "name")
    .field("namespace", def("XJSIdentifier"))
    .field("name", def("XJSIdentifier"));

def("XJSMemberExpression")
    .bases("MemberExpression")
    .build("object", "property")
    .field("object", or(def("XJSIdentifier"), def("XJSMemberExpression")))
    .field("property", def("XJSIdentifier"))
    .field("computed", isBoolean, defaults.false);

var XJSElementName = or(
    def("XJSIdentifier"),
    def("XJSNamespacedName"),
    def("XJSMemberExpression")
);

def("XJSSpreadAttribute")
    .bases("Node")
    .build("argument")
    .field("argument", def("Expression"));

var XJSAttributes = [or(
    def("XJSAttribute"),
    def("XJSSpreadAttribute")
)];

def("XJSExpressionContainer")
    .bases("Expression")
    .build("expression")
    .field("expression", def("Expression"));

def("XJSElement")
    .bases("Expression")
    .build("openingElement", "closingElement", "children")
    .field("openingElement", def("XJSOpeningElement"))
    .field("closingElement", or(def("XJSClosingElement"), null), defaults["null"])
    .field("children", [or(
        def("XJSElement"),
        def("XJSExpressionContainer"),
        def("XJSText"),
        def("Literal") // TODO Esprima should return XJSText instead.
    )], defaults.emptyArray)
    .field("name", XJSElementName, function() {
        // Little-known fact: the `this` object inside a default function
        // is none other than the partially-built object itself, and any
        // fields initialized directly from builder function arguments
        // (like openingElement, closingElement, and children) are
        // guaranteed to be available.
        return this.openingElement.name;
    })
    .field("selfClosing", isBoolean, function() {
        return this.openingElement.selfClosing;
    })
    .field("attributes", XJSAttributes, function() {
        return this.openingElement.attributes;
    });

def("XJSOpeningElement")
    .bases("Node") // TODO Does this make sense? Can't really be an XJSElement.
    .build("name", "attributes", "selfClosing")
    .field("name", XJSElementName)
    .field("attributes", XJSAttributes, defaults.emptyArray)
    .field("selfClosing", isBoolean, defaults["false"]);

def("XJSClosingElement")
    .bases("Node") // TODO Same concern.
    .build("name")
    .field("name", XJSElementName);

def("XJSText")
    .bases("Literal")
    .build("value")
    .field("value", isString);

def("XJSEmptyExpression").bases("Expression").build();

def("TypeAnnotatedIdentifier")
    .bases("Pattern")
    .build("annotation", "identifier")
    .field("annotation", def("TypeAnnotation"))
    .field("identifier", def("Identifier"));

def("TypeAnnotation")
    .bases("Pattern")
    .build("annotatedType", "templateTypes", "paramTypes", "returnType", 
           "unionType", "nullable")
    .field("annotatedType", def("Identifier"))
    .field("templateTypes", or([def("TypeAnnotation")], null))
    .field("paramTypes", or([def("TypeAnnotation")], null))
    .field("returnType", or(def("TypeAnnotation"), null))
    .field("unionType", or(def("TypeAnnotation"), null))
    .field("nullable", isBoolean);

},{"../lib/shared":16,"../lib/types":18,"./core":5}],10:[function(require,module,exports){
require("./core");
var types = require("../lib/types");
var def = types.Type.def;
var or = types.Type.or;
var geq = require("../lib/shared").geq;

def("ForOfStatement")
    .bases("Statement")
    .build("left", "right", "body")
    .field("left", or(
        def("VariableDeclaration"),
        def("Expression")))
    .field("right", def("Expression"))
    .field("body", def("Statement"));

def("LetStatement")
    .bases("Statement")
    .build("head", "body")
    // TODO Deviating from the spec by reusing VariableDeclarator here.
    .field("head", [def("VariableDeclarator")])
    .field("body", def("Statement"));

def("LetExpression")
    .bases("Expression")
    .build("head", "body")
    // TODO Deviating from the spec by reusing VariableDeclarator here.
    .field("head", [def("VariableDeclarator")])
    .field("body", def("Expression"));

def("GraphExpression")
    .bases("Expression")
    .build("index", "expression")
    .field("index", geq(0))
    .field("expression", def("Literal"));

def("GraphIndexExpression")
    .bases("Expression")
    .build("index")
    .field("index", geq(0));

},{"../lib/shared":16,"../lib/types":18,"./core":5}],11:[function(require,module,exports){
var assert = require("assert");
var types = require("../main");
var getFieldNames = types.getFieldNames;
var getFieldValue = types.getFieldValue;
var isArray = types.builtInTypes.array;
var isObject = types.builtInTypes.object;
var isDate = types.builtInTypes.Date;
var isRegExp = types.builtInTypes.RegExp;
var hasOwn = Object.prototype.hasOwnProperty;

function astNodesAreEquivalent(a, b, problemPath) {
    if (isArray.check(problemPath)) {
        problemPath.length = 0;
    } else {
        problemPath = null;
    }

    return areEquivalent(a, b, problemPath);
}

astNodesAreEquivalent.assert = function(a, b) {
    var problemPath = [];
    if (!astNodesAreEquivalent(a, b, problemPath)) {
        if (problemPath.length === 0) {
            assert.strictEqual(a, b);
        } else {
            assert.ok(
                false,
                "Nodes differ in the following path: " +
                    problemPath.map(subscriptForProperty).join("")
            );
        }
    }
};

function subscriptForProperty(property) {
    if (/[_$a-z][_$a-z0-9]*/i.test(property)) {
        return "." + property;
    }
    return "[" + JSON.stringify(property) + "]";
}

function areEquivalent(a, b, problemPath) {
    if (a === b) {
        return true;
    }

    if (isArray.check(a)) {
        return arraysAreEquivalent(a, b, problemPath);
    }

    if (isObject.check(a)) {
        return objectsAreEquivalent(a, b, problemPath);
    }

    if (isDate.check(a)) {
        return isDate.check(b) && (+a === +b);
    }

    if (isRegExp.check(a)) {
        return isRegExp.check(b) && (
            a.source === b.source &&
            a.global === b.global &&
            a.multiline === b.multiline &&
            a.ignoreCase === b.ignoreCase
        );
    }

    return a == b;
}

function arraysAreEquivalent(a, b, problemPath) {
    isArray.assert(a);
    var aLength = a.length;

    if (!isArray.check(b) || b.length !== aLength) {
        if (problemPath) {
            problemPath.push("length");
        }
        return false;
    }

    for (var i = 0; i < aLength; ++i) {
        if (problemPath) {
            problemPath.push(i);
        }

        if (i in a !== i in b) {
            return false;
        }

        if (!areEquivalent(a[i], b[i], problemPath)) {
            return false;
        }

        if (problemPath) {
            assert.strictEqual(problemPath.pop(), i);
        }
    }

    return true;
}

function objectsAreEquivalent(a, b, problemPath) {
    isObject.assert(a);
    if (!isObject.check(b)) {
        return false;
    }

    // Fast path for a common property of AST nodes.
    if (a.type !== b.type) {
        if (problemPath) {
            problemPath.push("type");
        }
        return false;
    }

    var aNames = getFieldNames(a);
    var aNameCount = aNames.length;

    var bNames = getFieldNames(b);
    var bNameCount = bNames.length;

    if (aNameCount === bNameCount) {
        for (var i = 0; i < aNameCount; ++i) {
            var name = aNames[i];
            var aChild = getFieldValue(a, name);
            var bChild = getFieldValue(b, name);

            if (problemPath) {
                problemPath.push(name);
            }

            if (!areEquivalent(aChild, bChild, problemPath)) {
                return false;
            }

            if (problemPath) {
                assert.strictEqual(problemPath.pop(), name);
            }
        }

        return true;
    }

    if (!problemPath) {
        return false;
    }

    // Since aNameCount !== bNameCount, we need to find some name that's
    // missing in aNames but present in bNames, or vice-versa.

    var seenNames = Object.create(null);

    for (i = 0; i < aNameCount; ++i) {
        seenNames[aNames[i]] = true;
    }

    for (i = 0; i < bNameCount; ++i) {
        name = bNames[i];

        if (!hasOwn.call(seenNames, name)) {
            problemPath.push(name);
            return false;
        }

        delete seenNames[name];
    }

    for (name in seenNames) {
        problemPath.push(name);
        break;
    }

    return false;
}

module.exports = astNodesAreEquivalent;

},{"../main":19,"assert":4}],12:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var n = types.namedTypes;
var isNumber = types.builtInTypes.number;
var isArray = types.builtInTypes.array;
var Path = require("./path");
var Scope = require("./scope");

function NodePath(value, parentPath, name) {
    assert.ok(this instanceof NodePath);
    Path.call(this, value, parentPath, name);
}

require("util").inherits(NodePath, Path);
var NPp = NodePath.prototype;

Object.defineProperties(NPp, {
    node: {
        get: function() {
            Object.defineProperty(this, "node", {
                configurable: true, // Enable deletion.
                value: this._computeNode()
            });

            return this.node;
        }
    },

    parent: {
        get: function() {
            Object.defineProperty(this, "parent", {
                configurable: true, // Enable deletion.
                value: this._computeParent()
            });

            return this.parent;
        }
    },

    scope: {
        get: function() {
            Object.defineProperty(this, "scope", {
                configurable: true, // Enable deletion.
                value: this._computeScope()
            });

            return this.scope;
        }
    }
});

NPp.replace = function() {
    delete this.node;
    delete this.parent;
    delete this.scope;
    return Path.prototype.replace.apply(this, arguments);
};

// The value of the first ancestor Path whose value is a Node.
NPp._computeNode = function() {
    var value = this.value;
    if (n.Node.check(value)) {
        return value;
    }

    var pp = this.parentPath;
    return pp && pp.node || null;
};

// The first ancestor Path whose value is a Node distinct from this.node.
NPp._computeParent = function() {
    var value = this.value;
    var pp = this.parentPath;

    if (!n.Node.check(value)) {
        while (pp && !n.Node.check(pp.value)) {
            pp = pp.parentPath;
        }

        if (pp) {
            pp = pp.parentPath;
        }
    }

    while (pp && !n.Node.check(pp.value)) {
        pp = pp.parentPath;
    }

    return pp || null;
};

// The closest enclosing scope that governs this node.
NPp._computeScope = function() {
    var value = this.value;
    var pp = this.parentPath;
    var scope = pp && pp.scope;

    if (n.Node.check(value) &&
        Scope.isEstablishedBy(value)) {
        scope = new Scope(this, scope);
    }

    return scope || null;
};

NPp.getValueProperty = function(name) {
    return types.getFieldValue(this.value, name);
};

/**
 * Determine whether this.node needs to be wrapped in parentheses in order
 * for a parser to reproduce the same local AST structure.
 *
 * For instance, in the expression `(1 + 2) * 3`, the BinaryExpression
 * whose operator is "+" needs parentheses, because `1 + 2 * 3` would
 * parse differently.
 *
 * If assumeExpressionContext === true, we don't worry about edge cases
 * like an anonymous FunctionExpression appearing lexically first in its
 * enclosing statement and thus needing parentheses to avoid being parsed
 * as a FunctionDeclaration with a missing name.
 */
NPp.needsParens = function(assumeExpressionContext) {
    if (!this.parent)
        return false;

    var node = this.node;

    // If this NodePath object is not the direct owner of this.node, then
    // we do not need parentheses here, though the direct owner might need
    // parentheses.
    if (node !== this.value)
        return false;

    var parent = this.parent.node;

    assert.notStrictEqual(node, parent);

    if (!n.Expression.check(node))
        return false;

    if (isUnaryLike(node))
        return n.MemberExpression.check(parent)
            && this.name === "object"
            && parent.object === node;

    if (isBinary(node)) {
        if (n.CallExpression.check(parent) &&
            this.name === "callee") {
            assert.strictEqual(parent.callee, node);
            return true;
        }

        if (isUnaryLike(parent))
            return true;

        if (n.MemberExpression.check(parent) &&
            this.name === "object") {
            assert.strictEqual(parent.object, node);
            return true;
        }

        if (isBinary(parent)) {
            var po = parent.operator;
            var pp = PRECEDENCE[po];
            var no = node.operator;
            var np = PRECEDENCE[no];

            if (pp > np) {
                return true;
            }

            if (pp === np && this.name === "right") {
                assert.strictEqual(parent.right, node);
                return true;
            }
        }
    }

    if (n.SequenceExpression.check(node)) {
        if (n.ForStatement.check(parent)) {
            // Although parentheses wouldn't hurt around sequence
            // expressions in the head of for loops, traditional style
            // dictates that e.g. i++, j++ should not be wrapped with
            // parentheses.
            return false;
        }

        if (n.ExpressionStatement.check(parent) &&
            this.name === "expression") {
            return false;
        }

        // Otherwise err on the side of overparenthesization, adding
        // explicit exceptions above if this proves overzealous.
        return true;
    }

    if (n.YieldExpression.check(node))
        return isBinary(parent)
            || n.CallExpression.check(parent)
            || n.MemberExpression.check(parent)
            || n.NewExpression.check(parent)
            || n.ConditionalExpression.check(parent)
            || isUnaryLike(parent)
            || n.YieldExpression.check(parent);

    if (n.NewExpression.check(parent) &&
        this.name === "callee") {
        assert.strictEqual(parent.callee, node);
        return containsCallExpression(node);
    }

    if (n.Literal.check(node) &&
        isNumber.check(node.value) &&
        n.MemberExpression.check(parent) &&
        this.name === "object") {
        assert.strictEqual(parent.object, node);
        return true;
    }

    if (n.AssignmentExpression.check(node) ||
        n.ConditionalExpression.check(node)) {
        if (isUnaryLike(parent))
            return true;

        if (isBinary(parent))
            return true;

        if (n.CallExpression.check(parent) &&
            this.name === "callee") {
            assert.strictEqual(parent.callee, node);
            return true;
        }

        if (n.ConditionalExpression.check(parent) &&
            this.name === "test") {
            assert.strictEqual(parent.test, node);
            return true;
        }

        if (n.MemberExpression.check(parent) &&
            this.name === "object") {
            assert.strictEqual(parent.object, node);
            return true;
        }
    }

    if (assumeExpressionContext !== true &&
        !this.canBeFirstInStatement() &&
        this.firstInStatement())
        return true;

    return false;
};

function isBinary(node) {
    return n.BinaryExpression.check(node)
        || n.LogicalExpression.check(node);
}

function isUnaryLike(node) {
    return n.UnaryExpression.check(node)
        // I considered making SpreadElement and SpreadProperty subtypes
        // of UnaryExpression, but they're not really Expression nodes.
        || (n.SpreadElement && n.SpreadElement.check(node))
        || (n.SpreadProperty && n.SpreadProperty.check(node));
}

var PRECEDENCE = {};
[["||"],
 ["&&"],
 ["|"],
 ["^"],
 ["&"],
 ["==", "===", "!=", "!=="],
 ["<", ">", "<=", ">=", "in", "instanceof"],
 [">>", "<<", ">>>"],
 ["+", "-"],
 ["*", "/", "%"]
].forEach(function(tier, i) {
    tier.forEach(function(op) {
        PRECEDENCE[op] = i;
    });
});

function containsCallExpression(node) {
    if (n.CallExpression.check(node)) {
        return true;
    }

    if (isArray.check(node)) {
        return node.some(containsCallExpression);
    }

    if (n.Node.check(node)) {
        return types.someField(node, function(name, child) {
            return containsCallExpression(child);
        });
    }

    return false;
}

NPp.canBeFirstInStatement = function() {
    var node = this.node;
    return !n.FunctionExpression.check(node)
        && !n.ObjectExpression.check(node);
};

NPp.firstInStatement = function() {
    return firstInStatement(this);
};

function firstInStatement(path) {
    for (var node, parent; path.parent; path = path.parent) {
        node = path.node;
        parent = path.parent.node;

        if (n.BlockStatement.check(parent) &&
            path.parent.name === "body" &&
            path.name === 0) {
            assert.strictEqual(parent.body[0], node);
            return true;
        }

        if (n.ExpressionStatement.check(parent) &&
            path.name === "expression") {
            assert.strictEqual(parent.expression, node);
            return true;
        }

        if (n.SequenceExpression.check(parent) &&
            path.parent.name === "expressions" &&
            path.name === 0) {
            assert.strictEqual(parent.expressions[0], node);
            continue;
        }

        if (n.CallExpression.check(parent) &&
            path.name === "callee") {
            assert.strictEqual(parent.callee, node);
            continue;
        }

        if (n.MemberExpression.check(parent) &&
            path.name === "object") {
            assert.strictEqual(parent.object, node);
            continue;
        }

        if (n.ConditionalExpression.check(parent) &&
            path.name === "test") {
            assert.strictEqual(parent.test, node);
            continue;
        }

        if (isBinary(parent) &&
            path.name === "left") {
            assert.strictEqual(parent.left, node);
            continue;
        }

        if (n.UnaryExpression.check(parent) &&
            !parent.prefix &&
            path.name === "argument") {
            assert.strictEqual(parent.argument, node);
            continue;
        }

        return false;
    }

    return true;
}

module.exports = NodePath;

},{"./path":14,"./scope":15,"./types":18,"assert":4,"util":50}],13:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var NodePath = require("./node-path");
var Node = types.namedTypes.Node;
var isArray = types.builtInTypes.array;
var isObject = types.builtInTypes.object;
var isFunction = types.builtInTypes.function;
var hasOwn = Object.prototype.hasOwnProperty;
var undefined;

function PathVisitor() {
    assert.ok(this instanceof PathVisitor);
    this._reusableContextStack = [];
    this._methodNameTable = computeMethodNameTable(this);
    this.Context = makeContextConstructor(this);
}

function computeMethodNameTable(visitor) {
    var typeNames = Object.create(null);

    for (var methodName in visitor) {
        if (/^visit[A-Z]/.test(methodName)) {
            typeNames[methodName.slice("visit".length)] = true;
        }
    }

    var supertypeTable = types.computeSupertypeLookupTable(typeNames);
    var methodNameTable = Object.create(null);

    for (var typeName in supertypeTable) {
        if (hasOwn.call(supertypeTable, typeName)) {
            methodName = "visit" + supertypeTable[typeName];
            if (isFunction.check(visitor[methodName])) {
                methodNameTable[typeName] = methodName;
            }
        }
    }

    return methodNameTable;
}

PathVisitor.fromMethodsObject = function fromMethodsObject(methods) {
    if (methods instanceof PathVisitor) {
        return methods;
    }

    if (!isObject.check(methods)) {
        // An empty visitor?
        return new PathVisitor;
    }

    function Visitor() {
        assert.ok(this instanceof Visitor);
        PathVisitor.call(this);
    }

    var Vp = Visitor.prototype = Object.create(PVp);
    Vp.constructor = Visitor;

    extend(Vp, methods);
    extend(Visitor, PathVisitor);

    isFunction.assert(Visitor.fromMethodsObject);
    isFunction.assert(Visitor.visit);

    return new Visitor;
};

function extend(target, source) {
    for (var property in source) {
        if (hasOwn.call(source, property)) {
            target[property] = source[property];
        }
    }

    return target;
}

PathVisitor.visit = function visit(node, methods) {
    var visitor = PathVisitor.fromMethodsObject(methods);

    if (node instanceof NodePath) {
        visitor.visit(node);
        return node.value;
    }

    var rootPath = new NodePath({ root: node });
    visitor.visit(rootPath.get("root"));
    return rootPath.value.root;
};

var PVp = PathVisitor.prototype;

PVp.visit = function(path) {
    if (this instanceof this.Context) {
        // If we somehow end up calling context.visit, then we need to
        // re-invoke the .visit method against context.visitor.
        return this.visitor.visit(path);
    }

    assert.ok(path instanceof NodePath);
    var value = path.value;

    var methodName = Node.check(value) && this._methodNameTable[value.type];
    if (methodName) {
        var context = this.acquireContext(path);
        try {
            context.invokeVisitorMethod(methodName);
        } finally {
            this.releaseContext(context);
        }

    } else {
        // If there was no visitor method to call, visit the children of
        // this node generically.
        visitChildren(path, this);
    }
};

function visitChildren(path, visitor) {
    assert.ok(path instanceof NodePath);
    assert.ok(visitor instanceof PathVisitor);

    var value = path.value;

    if (isArray.check(value)) {
        path.each(visitor.visit, visitor);
    } else if (!isObject.check(value)) {
        // No children to visit.
    } else {
        var name, names = types.getFieldNames(value);
        for (var i = 0, len = names.length; i < len; ++i) {
            if (!hasOwn.call(value, name = names[i])) {
                value[name] = types.getFieldValue(value, name);
            }
            visitor.visit(path.get(name));
        }
    }
}

PVp.acquireContext = function(path) {
    if (this._reusableContextStack.length === 0) {
        return new this.Context(path);
    }
    return this._reusableContextStack.pop().reset(path);
};

PVp.releaseContext = function(context) {
    assert.ok(context instanceof this.Context);
    this._reusableContextStack.push(context);
    context.currentPath = null;
};

function makeContextConstructor(visitor) {
    function Context(path) {
        assert.ok(this instanceof Context);
        assert.ok(this instanceof PathVisitor);
        assert.ok(path instanceof NodePath);

        Object.defineProperty(this, "visitor", {
            value: visitor,
            writable: false,
            enumerable: true,
            configurable: false
        });

        this.currentPath = path;
        this.needToCallTraverse = true;

        Object.seal(this);
    }

    assert.ok(visitor instanceof PathVisitor);

    // Note that the visitor object is the prototype of Context.prototype,
    // so all visitor methods are inherited by context objects.
    var Cp = Context.prototype = Object.create(visitor);

    Cp.constructor = Context;
    extend(Cp, sharedContextProtoMethods);

    return Context;
}

// Every PathVisitor has a different this.Context constructor and
// this.Context.prototype object, but those prototypes can all use the
// same reset, invokeVisitorMethod, and traverse function objects.
var sharedContextProtoMethods = Object.create(null);

sharedContextProtoMethods.reset =
function reset(path) {
    assert.ok(this instanceof this.Context);
    assert.ok(path instanceof NodePath);

    this.currentPath = path;
    this.needToCallTraverse = true;

    return this;
};

sharedContextProtoMethods.invokeVisitorMethod =
function invokeVisitorMethod(methodName) {
    assert.ok(this instanceof this.Context);
    assert.ok(this.currentPath instanceof NodePath);

    var result = this.visitor[methodName].call(this, this.currentPath);

    if (result === false) {
        // Visitor methods return false to indicate that they have handled
        // their own traversal needs, and we should not complain if
        // this.needToCallTraverse is still true.
        this.needToCallTraverse = false;

    } else if (result !== undefined) {
        // Any other non-undefined value returned from the visitor method
        // is interpreted as a replacement value.
        this.currentPath = this.currentPath.replace(result)[0];

        if (this.needToCallTraverse) {
            // If this.traverse still hasn't been called, visit the
            // children of the replacement node.
            this.traverse(this.currentPath);
        }
    }

    assert.strictEqual(
        this.needToCallTraverse, false,
        "Must either call this.traverse or return false in " + methodName
    );
};

sharedContextProtoMethods.traverse =
function traverse(path, newVisitor) {
    assert.ok(this instanceof this.Context);
    assert.ok(path instanceof NodePath);
    assert.ok(this.currentPath instanceof NodePath);

    this.needToCallTraverse = false;

    visitChildren(path, PathVisitor.fromMethodsObject(
        newVisitor || this.visitor
    ));
};

module.exports = PathVisitor;

},{"./node-path":12,"./types":18,"assert":4}],14:[function(require,module,exports){
var assert = require("assert");
var Op = Object.prototype;
var hasOwn = Op.hasOwnProperty;
var types = require("./types");
var isArray = types.builtInTypes.array;
var isNumber = types.builtInTypes.number;
var Ap = Array.prototype;
var slice = Ap.slice;
var map = Ap.map;

function Path(value, parentPath, name) {
    assert.ok(this instanceof Path);

    if (parentPath) {
        assert.ok(parentPath instanceof Path);
    } else {
        parentPath = null;
        name = null;
    }

    // The value encapsulated by this Path, generally equal to
    // parentPath.value[name] if we have a parentPath.
    this.value = value;

    // The immediate parent Path of this Path.
    this.parentPath = parentPath;

    // The name of the property of parentPath.value through which this
    // Path's value was reached.
    this.name = name;

    // Calling path.get("child") multiple times always returns the same
    // child Path object, for both performance and consistency reasons.
    this.__childCache = null;
}

var Pp = Path.prototype;

function getChildCache(path) {
    // Lazily create the child cache. This also cheapens cache
    // invalidation, since you can just reset path.__childCache to null.
    return path.__childCache || (path.__childCache = Object.create(null));
}

function getChildPath(path, name) {
    var cache = getChildCache(path);
    var actualChildValue = path.getValueProperty(name);
    var childPath = cache[name];
    if (!hasOwn.call(cache, name) ||
        // Ensure consistency between cache and reality.
        childPath.value !== actualChildValue) {
        childPath = cache[name] = new path.constructor(
            actualChildValue, path, name
        );
    }
    return childPath;
}

// This method is designed to be overridden by subclasses that need to
// handle missing properties, etc.
Pp.getValueProperty = function getValueProperty(name) {
    return this.value[name];
};

Pp.get = function get(name) {
    var path = this;
    var names = arguments;
    var count = names.length;

    for (var i = 0; i < count; ++i) {
        path = getChildPath(path, names[i]);
    }

    return path;
};

Pp.each = function each(callback, context) {
    var childPaths = [];
    var len = this.value.length;
    var i = 0;

    // Collect all the original child paths before invoking the callback.
    for (var i = 0; i < len; ++i) {
        if (hasOwn.call(this.value, i)) {
            childPaths[i] = this.get(i);
        }
    }

    // Invoke the callback on just the original child paths, regardless of
    // any modifications made to the array by the callback. I chose these
    // semantics over cleverly invoking the callback on new elements because
    // this way is much easier to reason about.
    context = context || this;
    for (i = 0; i < len; ++i) {
        if (hasOwn.call(childPaths, i)) {
            callback.call(context, childPaths[i]);
        }
    }
};

Pp.map = function map(callback, context) {
    var result = [];

    this.each(function(childPath) {
        result.push(callback.call(this, childPath));
    }, context);

    return result;
};

Pp.filter = function filter(callback, context) {
    var result = [];

    this.each(function(childPath) {
        if (callback.call(this, childPath)) {
            result.push(childPath);
        }
    }, context);

    return result;
};

function emptyMoves() {}
function getMoves(path, offset, start, end) {
    isArray.assert(path.value);

    if (offset === 0) {
        return emptyMoves;
    }

    var length = path.value.length;
    if (length < 1) {
        return emptyMoves;
    }

    var argc = arguments.length;
    if (argc === 2) {
        start = 0;
        end = length;
    } else if (argc === 3) {
        start = Math.max(start, 0);
        end = length;
    } else {
        start = Math.max(start, 0);
        end = Math.min(end, length);
    }

    isNumber.assert(start);
    isNumber.assert(end);

    var moves = Object.create(null);
    var cache = getChildCache(path);

    for (var i = start; i < end; ++i) {
        if (hasOwn.call(path.value, i)) {
            var childPath = path.get(i);
            assert.strictEqual(childPath.name, i);
            var newIndex = i + offset;
            childPath.name = newIndex;
            moves[newIndex] = childPath;
            delete cache[i];
        }
    }

    delete cache.length;

    return function() {
        for (var newIndex in moves) {
            var childPath = moves[newIndex];
            assert.strictEqual(childPath.name, +newIndex);
            cache[newIndex] = childPath;
            path.value[newIndex] = childPath.value;
        }
    };
}

Pp.shift = function shift() {
    var move = getMoves(this, -1);
    var result = this.value.shift();
    move();
    return result;
};

Pp.unshift = function unshift(node) {
    var move = getMoves(this, arguments.length);
    var result = this.value.unshift.apply(this.value, arguments);
    move();
    return result;
};

Pp.push = function push(node) {
    isArray.assert(this.value);
    delete getChildCache(this).length
    return this.value.push.apply(this.value, arguments);
};

Pp.pop = function pop() {
    isArray.assert(this.value);
    var cache = getChildCache(this);
    delete cache[this.value.length - 1];
    delete cache.length;
    return this.value.pop();
};

Pp.insertAt = function insertAt(index, node) {
    var argc = arguments.length;
    var move = getMoves(this, argc - 1, index);
    if (move === emptyMoves) {
        return this;
    }

    index = Math.max(index, 0);

    for (var i = 1; i < argc; ++i) {
        this.value[index + i - 1] = arguments[i];
    }

    move();

    return this;
};

Pp.insertBefore = function insertBefore(node) {
    var pp = this.parentPath;
    var argc = arguments.length;
    var insertAtArgs = [this.name];
    for (var i = 0; i < argc; ++i) {
        insertAtArgs.push(arguments[i]);
    }
    return pp.insertAt.apply(pp, insertAtArgs);
};

Pp.insertAfter = function insertAfter(node) {
    var pp = this.parentPath;
    var argc = arguments.length;
    var insertAtArgs = [this.name + 1];
    for (var i = 0; i < argc; ++i) {
        insertAtArgs.push(arguments[i]);
    }
    return pp.insertAt.apply(pp, insertAtArgs);
};

function repairRelationshipWithParent(path) {
    assert.ok(path instanceof Path);

    var pp = path.parentPath;
    if (!pp) {
        // Orphan paths have no relationship to repair.
        return path;
    }

    var parentValue = pp.value;
    var parentCache = getChildCache(pp);

    // Make sure parentCache[path.name] is populated.
    if (parentValue[path.name] === path.value) {
        parentCache[path.name] = path;
    } else if (isArray.check(parentValue)) {
        // Something caused path.name to become out of date, so attempt to
        // recover by searching for path.value in parentValue.
        var i = parentValue.indexOf(path.value);
        if (i >= 0) {
            parentCache[path.name = i] = path;
        }
    } else {
        // If path.value disagrees with parentValue[path.name], and
        // path.name is not an array index, let path.value become the new
        // parentValue[path.name] and update parentCache accordingly.
        parentValue[path.name] = path.value;
        parentCache[path.name] = path;
    }

    assert.strictEqual(parentValue[path.name], path.value);
    assert.strictEqual(path.parentPath.get(path.name), path);

    return path;
}

Pp.replace = function replace(replacement) {
    var results = [];
    var parentValue = this.parentPath.value;
    var parentCache = getChildCache(this.parentPath);
    var count = arguments.length;

    repairRelationshipWithParent(this);

    if (isArray.check(parentValue)) {
        var originalLength = parentValue.length;
        var move = getMoves(this.parentPath, count - 1, this.name + 1);

        var spliceArgs = [this.name, 1];
        for (i = 0; i < count; ++i) {
            spliceArgs.push(arguments[i]);
        }

        var splicedOut = parentValue.splice.apply(parentValue, spliceArgs);

        assert.strictEqual(splicedOut[0], this.value);
        assert.strictEqual(
            parentValue.length,
            originalLength - 1 + count
        );

        move();

        if (count === 0) {
            delete this.value;
            delete parentCache[this.name];
            this.__childCache = null;

        } else {
            assert.strictEqual(parentValue[this.name], replacement);

            if (this.value !== replacement) {
                this.value = replacement;
                this.__childCache = null;
            }

            for (i = 0; i < count; ++i) {
                results.push(this.parentPath.get(this.name + i));
            }

            assert.strictEqual(results[0], this);
        }

    } else if (count === 1) {
        if (this.value !== replacement) {
            this.__childCache = null;
        }
        this.value = parentValue[this.name] = replacement;
        results.push(this);

    } else if (count === 0) {
        delete parentValue[this.name];
        delete this.value;
        this.__childCache = null;

        // Leave this path cached as parentCache[this.name], even though
        // it no longer has a value defined.

    } else {
        assert.ok(false, "Could not replace path");
    }

    return results;
};

module.exports = Path;

},{"./types":18,"assert":4}],15:[function(require,module,exports){
var assert = require("assert");
var types = require("./types");
var Type = types.Type;
var namedTypes = types.namedTypes;
var Node = namedTypes.Node;
var isArray = types.builtInTypes.array;
var hasOwn = Object.prototype.hasOwnProperty;
var b = types.builders;

function Scope(path, parentScope) {
    assert.ok(this instanceof Scope);
    assert.ok(path instanceof require("./node-path"));
    ScopeType.assert(path.value);

    var depth;

    if (parentScope) {
        assert.ok(parentScope instanceof Scope);
        depth = parentScope.depth + 1;
    } else {
        parentScope = null;
        depth = 0;
    }

    Object.defineProperties(this, {
        path: { value: path },
        node: { value: path.value },
        isGlobal: { value: !parentScope, enumerable: true },
        depth: { value: depth },
        parent: { value: parentScope },
        bindings: { value: {} }
    });
}

var scopeTypes = [
    // Program nodes introduce global scopes.
    namedTypes.Program,

    // Function is the supertype of FunctionExpression,
    // FunctionDeclaration, ArrowExpression, etc.
    namedTypes.Function,

    // In case you didn't know, the caught parameter shadows any variable
    // of the same name in an outer scope.
    namedTypes.CatchClause
];

var ScopeType = Type.or.apply(Type, scopeTypes);

Scope.isEstablishedBy = function(node) {
    return ScopeType.check(node);
};

var Sp = Scope.prototype;

// Will be overridden after an instance lazily calls scanScope.
Sp.didScan = false;

Sp.declares = function(name) {
    this.scan();
    return hasOwn.call(this.bindings, name);
};

Sp.declareTemporary = function(prefix) {
    if (prefix) {
        assert.ok(/^[a-z$_]/i.test(prefix), prefix);
    } else {
        prefix = "t$";
    }

    // Include this.depth in the name to make sure the name does not
    // collide with any variables in nested/enclosing scopes.
    prefix += this.depth.toString(36) + "$";

    this.scan();

    var index = 0;
    while (this.declares(prefix + index)) {
        ++index;
    }

    var name = prefix + index;
    return this.bindings[name] = types.builders.identifier(name);
};

Sp.injectTemporary = function(identifier, init) {
    identifier || (identifier = this.declareTemporary());

    var bodyPath = this.path.get("body");
    if (namedTypes.BlockStatement.check(bodyPath.value)) {
        bodyPath = bodyPath.get("body");
    }

    bodyPath.unshift(
        b.variableDeclaration(
            "var",
            [b.variableDeclarator(identifier, init || null)]
        )
    );

    return identifier;
};

Sp.scan = function(force) {
    if (force || !this.didScan) {
        for (var name in this.bindings) {
            // Empty out this.bindings, just in cases.
            delete this.bindings[name];
        }
        scanScope(this.path, this.bindings);
        this.didScan = true;
    }
};

Sp.getBindings = function () {
    this.scan();
    return this.bindings;
};

function scanScope(path, bindings) {
    var node = path.value;
    ScopeType.assert(node);

    if (namedTypes.CatchClause.check(node)) {
        // A catch clause establishes a new scope but the only variable
        // bound in that scope is the catch parameter. Any other
        // declarations create bindings in the outer scope.
        addPattern(path.get("param"), bindings);

    } else {
        recursiveScanScope(path, bindings);
    }
}

function recursiveScanScope(path, bindings) {
    var node = path.value;

    if (path.parent &&
        namedTypes.FunctionExpression.check(path.parent.node) &&
        path.parent.node.id) {
        addPattern(path.parent.get("id"), bindings);

    } else if (isArray.check(node)) {
        path.each(function(childPath) {
            recursiveScanChild(childPath, bindings);
        });

    } else if (namedTypes.Function.check(node)) {
        path.get("params").each(function(paramPath) {
            addPattern(paramPath, bindings);
        });

        recursiveScanChild(path.get("body"), bindings);

    } else if (namedTypes.VariableDeclarator.check(node)) {
        addPattern(path.get("id"), bindings);
        recursiveScanChild(path.get("init"), bindings);

    } else if (namedTypes.ImportSpecifier &&
               namedTypes.ImportSpecifier.check(node)) {
        addPattern(
          node.name ? path.get("name") : path.get("id"),
          bindings
        );

    } else if (namedTypes.ModuleDeclaration &&
               namedTypes.ModuleDeclaration.check(node)) {
        addPattern(path.get("id"), bindings);

    } else if (Node.check(node)) {
        types.eachField(node, function(name, child) {
            var childPath = path.get(name);
            assert.strictEqual(childPath.value, child);
            recursiveScanChild(childPath, bindings);
        });
    }
}

function recursiveScanChild(path, bindings) {
    var node = path.value;

    if (namedTypes.FunctionDeclaration.check(node)) {
        addPattern(path.get("id"), bindings);

    } else if (namedTypes.ClassDeclaration &&
               namedTypes.ClassDeclaration.check(node)) {
        addPattern(path.get("id"), bindings);

    } else if (Scope.isEstablishedBy(node)) {
        if (namedTypes.CatchClause.check(node)) {
            var catchParamName = node.param.name;
            var hadBinding = hasOwn.call(bindings, catchParamName);

            // Any declarations that occur inside the catch body that do
            // not have the same name as the catch parameter should count
            // as bindings in the outer scope.
            recursiveScanScope(path.get("body"), bindings);

            // If a new binding matching the catch parameter name was
            // created while scanning the catch body, ignore it because it
            // actually refers to the catch parameter and not the outer
            // scope that we're currently scanning.
            if (!hadBinding) {
                delete bindings[catchParamName];
            }
        }

    } else {
        recursiveScanScope(path, bindings);
    }
}

function addPattern(patternPath, bindings) {
    var pattern = patternPath.value;
    namedTypes.Pattern.assert(pattern);

    if (namedTypes.Identifier.check(pattern)) {
        if (hasOwn.call(bindings, pattern.name)) {
            bindings[pattern.name].push(patternPath);
        } else {
            bindings[pattern.name] = [patternPath];
        }

    } else if (namedTypes.SpreadElement &&
               namedTypes.SpreadElement.check(pattern)) {
        addPattern(patternPath.get("argument"), bindings);
    }
}

Sp.lookup = function(name) {
    for (var scope = this; scope; scope = scope.parent)
        if (scope.declares(name))
            break;
    return scope;
};

Sp.getGlobalScope = function() {
    var scope = this;
    while (!scope.isGlobal)
        scope = scope.parent;
    return scope;
};

module.exports = Scope;

},{"./node-path":12,"./types":18,"assert":4}],16:[function(require,module,exports){
var types = require("../lib/types");
var Type = types.Type;
var builtin = types.builtInTypes;
var isNumber = builtin.number;

// An example of constructing a new type with arbitrary constraints from
// an existing type.
exports.geq = function(than) {
    return new Type(function(value) {
        return isNumber.check(value) && value >= than;
    }, isNumber + " >= " + than);
};

// Default value-returning functions that may optionally be passed as a
// third argument to Def.prototype.field.
exports.defaults = {
    // Functions were used because (among other reasons) that's the most
    // elegant way to allow for the emptyArray one always to give a new
    // array instance.
    "null": function() { return null },
    "emptyArray": function() { return [] },
    "false": function() { return false },
    "true": function() { return true },
    "undefined": function() {}
};

var naiveIsPrimitive = Type.or(
    builtin.string,
    builtin.number,
    builtin.boolean,
    builtin.null,
    builtin.undefined
);

exports.isPrimitive = new Type(function(value) {
    if (value === null)
        return true;
    var type = typeof value;
    return !(type === "object" ||
             type === "function");
}, naiveIsPrimitive.toString());

},{"../lib/types":18}],17:[function(require,module,exports){
var visit = require("./path-visitor").visit;
var deprecate = require("depd")('require("ast-types").traverse');

function traverseWithFullPathInfo(node, callback) {
    return visit(node, {
        visitNode: function(path) {
            if (callback.call(path, path.value) !== false) {
                this.traverse(path);
            }

            return false;
        }
    });
}

var deprecatedWrapper = deprecate.function(
    traverseWithFullPathInfo,
    'Please use require("ast-types").visit instead of .traverse for ' +
        'syntax tree manipulation'
);

deprecatedWrapper.fast = deprecatedWrapper;
module.exports = deprecatedWrapper;

},{"./path-visitor":13,"depd":23}],18:[function(require,module,exports){
var assert = require("assert");
var Ap = Array.prototype;
var slice = Ap.slice;
var map = Ap.map;
var each = Ap.forEach;
var Op = Object.prototype;
var objToStr = Op.toString;
var funObjStr = objToStr.call(function(){});
var strObjStr = objToStr.call("");
var hasOwn = Op.hasOwnProperty;

// A type is an object with a .check method that takes a value and returns
// true or false according to whether the value matches the type.

function Type(check, name) {
    var self = this;
    assert.ok(self instanceof Type, self);

    // Unfortunately we can't elegantly reuse isFunction and isString,
    // here, because this code is executed while defining those types.
    assert.strictEqual(objToStr.call(check), funObjStr,
                       check + " is not a function");

    // The `name` parameter can be either a function or a string.
    var nameObjStr = objToStr.call(name);
    assert.ok(nameObjStr === funObjStr ||
              nameObjStr === strObjStr,
              name + " is neither a function nor a string");

    Object.defineProperties(self, {
        name: { value: name },
        check: {
            value: function(value, deep) {
                var result = check.call(self, value, deep);
                if (!result && deep && objToStr.call(deep) === funObjStr)
                    deep(self, value);
                return result;
            }
        }
    });
}

var Tp = Type.prototype;

// Throughout this file we use Object.defineProperty to prevent
// redefinition of exported properties.
exports.Type = Type;

// Like .check, except that failure triggers an AssertionError.
Tp.assert = function(value, deep) {
    if (!this.check(value, deep)) {
        var str = shallowStringify(value);
        assert.ok(false, str + " does not match type " + this);
        return false;
    }
    return true;
};

function shallowStringify(value) {
    if (isObject.check(value))
        return "{" + Object.keys(value).map(function(key) {
            return key + ": " + value[key];
        }).join(", ") + "}";

    if (isArray.check(value))
        return "[" + value.map(shallowStringify).join(", ") + "]";

    return JSON.stringify(value);
}

Tp.toString = function() {
    var name = this.name;

    if (isString.check(name))
        return name;

    if (isFunction.check(name))
        return name.call(this) + "";

    return name + " type";
};

var builtInTypes = {};
exports.builtInTypes = builtInTypes;

function defBuiltInType(example, name) {
    var objStr = objToStr.call(example);

    Object.defineProperty(builtInTypes, name, {
        enumerable: true,
        value: new Type(function(value) {
            return objToStr.call(value) === objStr;
        }, name)
    });

    return builtInTypes[name];
}

// These types check the underlying [[Class]] attribute of the given
// value, rather than using the problematic typeof operator. Note however
// that no subtyping is considered; so, for instance, isObject.check
// returns false for [], /./, new Date, and null.
var isString = defBuiltInType("", "string");
var isFunction = defBuiltInType(function(){}, "function");
var isArray = defBuiltInType([], "array");
var isObject = defBuiltInType({}, "object");
var isRegExp = defBuiltInType(/./, "RegExp");
var isDate = defBuiltInType(new Date, "Date");
var isNumber = defBuiltInType(3, "number");
var isBoolean = defBuiltInType(true, "boolean");
var isNull = defBuiltInType(null, "null");
var isUndefined = defBuiltInType(void 0, "undefined");

// There are a number of idiomatic ways of expressing types, so this
// function serves to coerce them all to actual Type objects. Note that
// providing the name argument is not necessary in most cases.
function toType(from, name) {
    // The toType function should of course be idempotent.
    if (from instanceof Type)
        return from;

    // The Def type is used as a helper for constructing compound
    // interface types for AST nodes.
    if (from instanceof Def)
        return from.type;

    // Support [ElemType] syntax.
    if (isArray.check(from))
        return Type.fromArray(from);

    // Support { someField: FieldType, ... } syntax.
    if (isObject.check(from))
        return Type.fromObject(from);

    // If isFunction.check(from), assume that from is a binary predicate
    // function we can use to define the type.
    if (isFunction.check(from))
        return new Type(from, name);

    // As a last resort, toType returns a type that matches any value that
    // is === from. This is primarily useful for literal values like
    // toType(null), but it has the additional advantage of allowing
    // toType to be a total function.
    return new Type(function(value) {
        return value === from;
    }, isUndefined.check(name) ? function() {
        return from + "";
    } : name);
}

// Returns a type that matches the given value iff any of type1, type2,
// etc. match the value.
Type.or = function(/* type1, type2, ... */) {
    var types = [];
    var len = arguments.length;
    for (var i = 0; i < len; ++i)
        types.push(toType(arguments[i]));

    return new Type(function(value, deep) {
        for (var i = 0; i < len; ++i)
            if (types[i].check(value, deep))
                return true;
        return false;
    }, function() {
        return types.join(" | ");
    });
};

Type.fromArray = function(arr) {
    assert.ok(isArray.check(arr));
    assert.strictEqual(
        arr.length, 1,
        "only one element type is permitted for typed arrays");
    return toType(arr[0]).arrayOf();
};

Tp.arrayOf = function() {
    var elemType = this;
    return new Type(function(value, deep) {
        return isArray.check(value) && value.every(function(elem) {
            return elemType.check(elem, deep);
        });
    }, function() {
        return "[" + elemType + "]";
    });
};

Type.fromObject = function(obj) {
    var fields = Object.keys(obj).map(function(name) {
        return new Field(name, obj[name]);
    });

    return new Type(function(value, deep) {
        return isObject.check(value) && fields.every(function(field) {
            return field.type.check(value[field.name], deep);
        });
    }, function() {
        return "{ " + fields.join(", ") + " }";
    });
};

function Field(name, type, defaultFn, hidden) {
    var self = this;

    assert.ok(self instanceof Field);
    isString.assert(name);

    type = toType(type);

    var properties = {
        name: { value: name },
        type: { value: type },
        hidden: { value: !!hidden }
    };

    if (isFunction.check(defaultFn)) {
        properties.defaultFn = { value: defaultFn };
    }

    Object.defineProperties(self, properties);
}

var Fp = Field.prototype;

Fp.toString = function() {
    return JSON.stringify(this.name) + ": " + this.type;
};

Fp.getValue = function(obj) {
    var value = obj[this.name];

    if (!isUndefined.check(value))
        return value;

    if (this.defaultFn)
        value = this.defaultFn.call(obj);

    return value;
};

// Define a type whose name is registered in a namespace (the defCache) so
// that future definitions will return the same type given the same name.
// In particular, this system allows for circular and forward definitions.
// The Def object d returned from Type.def may be used to configure the
// type d.type by calling methods such as d.bases, d.build, and d.field.
Type.def = function(typeName) {
    isString.assert(typeName);
    return hasOwn.call(defCache, typeName)
        ? defCache[typeName]
        : defCache[typeName] = new Def(typeName);
};

// In order to return the same Def instance every time Type.def is called
// with a particular name, those instances need to be stored in a cache.
var defCache = Object.create(null);

function Def(typeName) {
    var self = this;
    assert.ok(self instanceof Def);

    Object.defineProperties(self, {
        typeName: { value: typeName },
        baseNames: { value: [] },
        ownFields: { value: Object.create(null) },

        // These two are populated during finalization.
        allSupertypes: { value: Object.create(null) }, // Includes own typeName.
        supertypeList: { value: [] }, // Linear inheritance hierarchy.
        allFields: { value: Object.create(null) }, // Includes inherited fields.
        fieldNames: { value: [] }, // Non-hidden keys of allFields.

        type: {
            value: new Type(function(value, deep) {
                return self.check(value, deep);
            }, typeName)
        }
    });
}

Def.fromValue = function(value) {
    if (value && typeof value === "object") {
        var type = value.type;
        if (typeof type === "string" &&
            hasOwn.call(defCache, type)) {
            var d = defCache[type];
            if (d.finalized) {
                return d;
            }
        }
    }

    return null;
};

var Dp = Def.prototype;

Dp.isSupertypeOf = function(that) {
    if (that instanceof Def) {
        assert.strictEqual(this.finalized, true);
        assert.strictEqual(that.finalized, true);
        return hasOwn.call(that.allSupertypes, this.typeName);
    } else {
        assert.ok(false, that + " is not a Def");
    }
};

// Note that the list returned by this function is a copy of the internal
// supertypeList, *without* the typeName itself as the first element.
exports.getSupertypeNames = function(typeName) {
    assert.ok(hasOwn.call(defCache, typeName));
    var d = defCache[typeName];
    assert.strictEqual(d.finalized, true);
    return d.supertypeList.slice(1);
};

// Returns an object mapping from every known type in the defCache to the
// most specific supertype whose name is an own property of the candidates
// object.
exports.computeSupertypeLookupTable = function(candidates) {
    var table = {};

    for (var typeName in defCache) {
        if (hasOwn.call(defCache, typeName)) {
            var d = defCache[typeName];
            assert.strictEqual(d.finalized, true);
            for (var i = 0; i < d.supertypeList.length; ++i) {
                var superTypeName = d.supertypeList[i];
                if (hasOwn.call(candidates, superTypeName)) {
                    table[typeName] = superTypeName;
                    break;
                }
            }
        }
    }

    return table;
};

Dp.checkAllFields = function(value, deep) {
    var allFields = this.allFields;
    assert.strictEqual(this.finalized, true);

    function checkFieldByName(name) {
        var field = allFields[name];
        var type = field.type;
        var child = field.getValue(value);
        return type.check(child, deep);
    }

    return isObject.check(value)
        && Object.keys(allFields).every(checkFieldByName);
};

Dp.check = function(value, deep) {
    assert.strictEqual(
        this.finalized, true,
        "prematurely checking unfinalized type " + this.typeName);

    // A Def type can only match an object value.
    if (!isObject.check(value))
        return false;

    var vDef = Def.fromValue(value);
    if (!vDef) {
        // If we couldn't infer the Def associated with the given value,
        // and we expected it to be a SourceLocation or a Position, it was
        // probably just missing a "type" field (because Esprima does not
        // assign a type property to such nodes). Be optimistic and let
        // this.checkAllFields make the final decision.
        if (this.typeName === "SourceLocation" ||
            this.typeName === "Position") {
            return this.checkAllFields(value, deep);
        }

        // Calling this.checkAllFields for any other type of node is both
        // bad for performance and way too forgiving.
        return false;
    }

    // If checking deeply and vDef === this, then we only need to call
    // checkAllFields once. Calling checkAllFields is too strict when deep
    // is false, because then we only care about this.isSupertypeOf(vDef).
    if (deep && vDef === this)
        return this.checkAllFields(value, deep);

    // In most cases we rely exclusively on isSupertypeOf to make O(1)
    // subtyping determinations. This suffices in most situations outside
    // of unit tests, since interface conformance is checked whenever new
    // instances are created using builder functions.
    if (!this.isSupertypeOf(vDef))
        return false;

    // The exception is when deep is true; then, we recursively check all
    // fields.
    if (!deep)
        return true;

    // Use the more specific Def (vDef) to perform the deep check, but
    // shallow-check fields defined by the less specific Def (this).
    return vDef.checkAllFields(value, deep)
        && this.checkAllFields(value, false);
};

Dp.bases = function() {
    var bases = this.baseNames;

    assert.strictEqual(this.finalized, false);

    each.call(arguments, function(baseName) {
        isString.assert(baseName);

        // This indexOf lookup may be O(n), but the typical number of base
        // names is very small, and indexOf is a native Array method.
        if (bases.indexOf(baseName) < 0)
            bases.push(baseName);
    });

    return this; // For chaining.
};

// False by default until .build(...) is called on an instance.
Object.defineProperty(Dp, "buildable", { value: false });

var builders = {};
exports.builders = builders;

// This object is used as prototype for any node created by a builder.
var nodePrototype = {};

// Call this function to define a new method to be shared by all AST
// nodes. The replaced method (if any) is returned for easy wrapping.
exports.defineMethod = function(name, func) {
    var old = nodePrototype[name];

    // Pass undefined as func to delete nodePrototype[name].
    if (isUndefined.check(func)) {
        delete nodePrototype[name];

    } else {
        isFunction.assert(func);

        Object.defineProperty(nodePrototype, name, {
            enumerable: true, // For discoverability.
            configurable: true, // For delete proto[name].
            value: func
        });
    }

    return old;
};

// Calling the .build method of a Def simultaneously marks the type as
// buildable (by defining builders[getBuilderName(typeName)]) and
// specifies the order of arguments that should be passed to the builder
// function to create an instance of the type.
Dp.build = function(/* param1, param2, ... */) {
    var self = this;

    // Calling Def.prototype.build multiple times has the effect of merely
    // redefining this property.
    Object.defineProperty(self, "buildParams", {
        value: slice.call(arguments),
        writable: false,
        enumerable: false,
        configurable: true
    });

    assert.strictEqual(self.finalized, false);
    isString.arrayOf().assert(self.buildParams);

    if (self.buildable) {
        // If this Def is already buildable, update self.buildParams and
        // continue using the old builder function.
        return self;
    }

    // Every buildable type will have its "type" field filled in
    // automatically. This includes types that are not subtypes of Node,
    // like SourceLocation, but that seems harmless (TODO?).
    self.field("type", self.typeName, function() { return self.typeName });

    // Override Dp.buildable for this Def instance.
    Object.defineProperty(self, "buildable", { value: true });

    Object.defineProperty(builders, getBuilderName(self.typeName), {
        enumerable: true,

        value: function() {
            var args = arguments;
            var argc = args.length;
            var built = Object.create(nodePrototype);

            assert.ok(
                self.finalized,
                "attempting to instantiate unfinalized type " + self.typeName);

            function add(param, i) {
                if (hasOwn.call(built, param))
                    return;

                var all = self.allFields;
                assert.ok(hasOwn.call(all, param), param);

                var field = all[param];
                var type = field.type;
                var value;

                if (isNumber.check(i) && i < argc) {
                    value = args[i];
                } else if (field.defaultFn) {
                    // Expose the partially-built object to the default
                    // function as its `this` object.
                    value = field.defaultFn.call(built);
                } else {
                    var message = "no value or default function given for field " +
                        JSON.stringify(param) + " of " + self.typeName + "(" +
                            self.buildParams.map(function(name) {
                                return all[name];
                            }).join(", ") + ")";
                    assert.ok(false, message);
                }

                assert.ok(
                    type.check(value),
                    shallowStringify(value) +
                        " does not match field " + field +
                        " of type " + self.typeName);

                // TODO Could attach getters and setters here to enforce
                // dynamic type safety.
                built[param] = value;
            }

            self.buildParams.forEach(function(param, i) {
                add(param, i);
            });

            Object.keys(self.allFields).forEach(function(param) {
                add(param); // Use the default value.
            });

            // Make sure that the "type" field was filled automatically.
            assert.strictEqual(built.type, self.typeName);

            return built;
        }
    });

    return self; // For chaining.
};

function getBuilderName(typeName) {
    return typeName.replace(/^[A-Z]+/, function(upperCasePrefix) {
        var len = upperCasePrefix.length;
        switch (len) {
        case 0: return "";
        // If there's only one initial capital letter, just lower-case it.
        case 1: return upperCasePrefix.toLowerCase();
        default:
            // If there's more than one initial capital letter, lower-case
            // all but the last one, so that XMLDefaultDeclaration (for
            // example) becomes xmlDefaultDeclaration.
            return upperCasePrefix.slice(
                0, len - 1).toLowerCase() +
                upperCasePrefix.charAt(len - 1);
        }
    });
}

// The reason fields are specified using .field(...) instead of an object
// literal syntax is somewhat subtle: the object literal syntax would
// support only one key and one value, but with .field(...) we can pass
// any number of arguments to specify the field.
Dp.field = function(name, type, defaultFn, hidden) {
    assert.strictEqual(this.finalized, false);
    this.ownFields[name] = new Field(name, type, defaultFn, hidden);
    return this; // For chaining.
};

var namedTypes = {};
exports.namedTypes = namedTypes;

// Like Object.keys, but aware of what fields each AST type should have.
function getFieldNames(object) {
    var d = Def.fromValue(object);
    if (d) {
        return d.fieldNames.slice(0);
    }

    assert.strictEqual(
        "type" in object, false,
        "did not recognize object of type " +
            JSON.stringify(object.type)
    );

    return Object.keys(object);
}
exports.getFieldNames = getFieldNames;

// Get the value of an object property, taking object.type and default
// functions into account.
function getFieldValue(object, fieldName) {
    var d = Def.fromValue(object);
    if (d) {
        var field = d.allFields[fieldName];
        if (field) {
            return field.getValue(object);
        }
    }

    return object[fieldName];
}
exports.getFieldValue = getFieldValue;

// Iterate over all defined fields of an object, including those missing
// or undefined, passing each field name and effective value (as returned
// by getFieldValue) to the callback. If the object has no corresponding
// Def, the callback will never be called.
exports.eachField = function(object, callback, context) {
    getFieldNames(object).forEach(function(name) {
        callback.call(this, name, getFieldValue(object, name));
    }, context);
};

// Similar to eachField, except that iteration stops as soon as the
// callback returns a truthy value. Like Array.prototype.some, the final
// result is either true or false to indicates whether the callback
// returned true for any element or not.
exports.someField = function(object, callback, context) {
    return getFieldNames(object).some(function(name) {
        return callback.call(this, name, getFieldValue(object, name));
    }, context);
};

// This property will be overridden as true by individual Def instances
// when they are finalized.
Object.defineProperty(Dp, "finalized", { value: false });

Dp.finalize = function() {
    // It's not an error to finalize a type more than once, but only the
    // first call to .finalize does anything.
    if (!this.finalized) {
        var allFields = this.allFields;
        var allSupertypes = this.allSupertypes;

        this.baseNames.forEach(function(name) {
            var def = defCache[name];
            def.finalize();
            extend(allFields, def.allFields);
            extend(allSupertypes, def.allSupertypes);
        });

        // TODO Warn if fields are overridden with incompatible types.
        extend(allFields, this.ownFields);
        allSupertypes[this.typeName] = this;

        this.fieldNames.length = 0;
        for (var fieldName in allFields) {
            if (hasOwn.call(allFields, fieldName) &&
                !allFields[fieldName].hidden) {
                this.fieldNames.push(fieldName);
            }
        }

        // Types are exported only once they have been finalized.
        Object.defineProperty(namedTypes, this.typeName, {
            enumerable: true,
            value: this.type
        });

        Object.defineProperty(this, "finalized", { value: true });

        // A linearization of the inheritance hierarchy.
        populateSupertypeList(this.typeName, this.supertypeList);
    }
};

function populateSupertypeList(typeName, list) {
    list.length = 0;
    list.push(typeName);

    var lastSeen = Object.create(null);

    for (var pos = 0; pos < list.length; ++pos) {
        typeName = list[pos];
        var d = defCache[typeName];
        assert.strictEqual(d.finalized, true);

        // If we saw typeName earlier in the breadth-first traversal,
        // delete the last-seen occurrence.
        if (hasOwn.call(lastSeen, typeName)) {
            delete list[lastSeen[typeName]];
        }

        // Record the new index of the last-seen occurrence of typeName.
        lastSeen[typeName] = pos;

        // Enqueue the base names of this type.
        list.push.apply(list, d.baseNames);
    }

    // Compaction loop to remove array holes.
    for (var to = 0, from = to, len = list.length; from < len; ++from) {
        if (hasOwn.call(list, from)) {
            list[to++] = list[from];
        }
    }

    list.length = to;
}

function extend(into, from) {
    Object.keys(from).forEach(function(name) {
        into[name] = from[name];
    });

    return into;
};

exports.finalize = function() {
    Object.keys(defCache).forEach(function(name) {
        defCache[name].finalize();
    });
};

},{"assert":4}],19:[function(require,module,exports){
var types = require("./lib/types");

// This core module of AST types captures ES5 as it is parsed today by
// git://github.com/ariya/esprima.git#master.
require("./def/core");

// Feel free to add to or remove from this list of extension modules to
// configure the precise type hierarchy that you need.
require("./def/es6");
require("./def/es7");
require("./def/mozilla");
require("./def/e4x");
require("./def/fb-harmony");

types.finalize();

exports.Type = types.Type;
exports.builtInTypes = types.builtInTypes;
exports.namedTypes = types.namedTypes;
exports.builders = types.builders;
exports.defineMethod = types.defineMethod;
exports.getFieldNames = types.getFieldNames;
exports.getFieldValue = types.getFieldValue;
exports.eachField = types.eachField;
exports.someField = types.someField;
exports.getSupertypeNames = types.getSupertypeNames;
exports.astNodesAreEquivalent = require("./lib/equiv");
exports.traverse = require("./lib/traverse");
exports.finalize = types.finalize;
exports.NodePath = require("./lib/node-path");
exports.PathVisitor = require("./lib/path-visitor");
exports.visit = exports.PathVisitor.visit;

},{"./def/core":5,"./def/e4x":6,"./def/es6":7,"./def/es7":8,"./def/fb-harmony":9,"./def/mozilla":10,"./lib/equiv":11,"./lib/node-path":12,"./lib/path-visitor":13,"./lib/traverse":17,"./lib/types":18}],20:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],21:[function(require,module,exports){

},{}],22:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Find the length
  var length
  if (type === 'number')
    length = subject > 0 ? subject >>> 0 : 0
  else if (type === 'string') {
    if (encoding === 'base64')
      subject = base64clean(subject)
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) { // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data))
      subject = subject.data
    length = +subject.length > 0 ? Math.floor(+subject.length) : 0
  } else
    throw new TypeError('must start with number, buffer, array or string')

  if (this.length > kMaxLength)
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
      'size: 0x' + kMaxLength.toString(16) + ' bytes')

  var buf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++)
        buf[i] = subject.readUInt8(i)
    } else {
      for (i = 0; i < length; i++)
        buf[i] = ((subject[i] % 256) + 256) % 256
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

Buffer.isBuffer = function (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b))
    throw new TypeError('Arguments must be Buffers')

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function (list, totalLength) {
  if (!isArray(list)) throw new TypeError('Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase)
          throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function (b) {
  if(!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max)
      str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b)
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(byte)) throw new Error('Invalid hex string')
    buf[offset + i] = byte
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string), buf, offset, length, 2)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function binarySlice (buf, start, end) {
  return asciiSlice(buf, start, end)
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len;
    if (start < 0)
      start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0)
      end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start)
    end = start

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0)
    throw new RangeError('offset is not uint')
  if (offset + ext > length)
    throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
      ((this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      this[offset + 3])
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80))
    return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
      (this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      (this[offset + 3])
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new TypeError('value is out of bounds')
  if (offset + ext > buf.length) throw new TypeError('index out of range')
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new TypeError('value is out of bounds')
  if (offset + ext > buf.length) throw new TypeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  if (end < start) throw new TypeError('sourceEnd < sourceStart')
  if (target_start < 0 || target_start >= target.length)
    throw new TypeError('targetStart out of bounds')
  if (start < 0 || start >= source.length) throw new TypeError('sourceStart out of bounds')
  if (end < 0 || end > source.length) throw new TypeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new TypeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new TypeError('start out of bounds')
  if (end < 0 || end > this.length) throw new TypeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F) {
      byteArray.push(b)
    } else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++) {
        byteArray.push(parseInt(h[j], 16))
      }
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length, unitSize) {
  if (unitSize) length -= length % unitSize;
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":20,"ieee754":34,"is-array":35}],23:[function(require,module,exports){
(function (process){
/*!
 * depd
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var callSiteToString = require('./lib/compat').callSiteToString
var EventEmitter = require('events').EventEmitter
var relative = require('path').relative

/**
 * Module exports.
 */

module.exports = depd

/**
 * Get the path to base files on.
 */

var basePath = process.cwd()

/**
 * Get listener count on event emitter.
 */

/*istanbul ignore next*/
var eventListenerCount = EventEmitter.listenerCount
  || function (emitter, type) { return emitter.listeners(type).length }

/**
 * Determine if namespace is contained in the string.
 */

function containsNamespace(str, namespace) {
  var val = str.split(/[ ,]+/)

  namespace = String(namespace).toLowerCase()

  for (var i = 0 ; i < val.length; i++) {
    if (!(str = val[i])) continue;

    // namespace contained
    if (str === '*' || str.toLowerCase() === namespace) {
      return true
    }
  }

  return false
}

/**
 * Convert a data descriptor to accessor descriptor.
 */

function convertDataDescriptorToAccessor(obj, prop, message) {
  var descriptor = Object.getOwnPropertyDescriptor(obj, prop)
  var value = descriptor.value

  descriptor.get = function getter() { return value }

  if (descriptor.writable) {
    descriptor.set = function setter(val) { return value = val }
  }

  delete descriptor.value
  delete descriptor.writable

  Object.defineProperty(obj, prop, descriptor)

  return descriptor
}

/**
 * Create arguments string to keep arity.
 */

function createArgumentsString(arity) {
  var str = ''

  for (var i = 0; i < arity; i++) {
    str += ', arg' + i
  }

  return str.substr(2)
}

/**
 * Create stack string from stack.
 */

function createStackString(stack) {
  var str = this.name + ': ' + this.namespace

  if (this.message) {
    str += ' deprecated ' + this.message
  }

  for (var i = 0; i < stack.length; i++) {
    str += '\n    at ' + callSiteToString(stack[i])
  }

  return str
}

/**
 * Create deprecate for namespace in caller.
 */

function depd(namespace) {
  if (!namespace) {
    throw new TypeError('argument namespace is required')
  }

  var stack = getStack()
  var site = callSiteLocation(stack[1])
  var file = site[0]

  function deprecate(message) {
    // call to self as log
    log.call(deprecate, message)
  }

  deprecate._file = file
  deprecate._ignored = isignored(namespace)
  deprecate._namespace = namespace
  deprecate._traced = istraced(namespace)
  deprecate._warned = Object.create(null)

  deprecate.function = wrapfunction
  deprecate.property = wrapproperty

  return deprecate
}

/**
 * Determine if namespace is ignored.
 */

function isignored(namespace) {
  /* istanbul ignore next: tested in a child processs */
  if (process.noDeprecation) {
    // --no-deprecation support
    return true
  }

  var str = process.env.NO_DEPRECATION || ''

  // namespace ignored
  return containsNamespace(str, namespace)
}

/**
 * Determine if namespace is traced.
 */

function istraced(namespace) {
  /* istanbul ignore next: tested in a child processs */
  if (process.traceDeprecation) {
    // --trace-deprecation support
    return true
  }

  var str = process.env.TRACE_DEPRECATION || ''

  // namespace traced
  return containsNamespace(str, namespace)
}

/**
 * Display deprecation message.
 */

function log(message, site) {
  var haslisteners = eventListenerCount(process, 'deprecation') !== 0

  // abort early if no destination
  if (!haslisteners && this._ignored) {
    return
  }

  var caller
  var callFile
  var callSite
  var i = 0
  var seen = false
  var stack = getStack()
  var file = this._file

  if (site) {
    // provided site
    callSite = callSiteLocation(stack[1])
    callSite.name = site.name
    file = callSite[0]
  } else {
    // get call site
    i = 2
    site = callSiteLocation(stack[i])
    callSite = site
  }

  // get caller of deprecated thing in relation to file
  for (; i < stack.length; i++) {
    caller = callSiteLocation(stack[i])
    callFile = caller[0]

    if (callFile === file) {
      seen = true
    } else if (callFile === this._file) {
      file = this._file
    } else if (seen) {
      break
    }
  }

  var key = caller
    ? site.join(':') + '__' + caller.join(':')
    : undefined

  if (key !== undefined && key in this._warned) {
    // already warned
    return
  }

  this._warned[key] = true

  // generate automatic message from call site
  if (!message) {
    message = callSite === site || !callSite.name
      ? defaultMessage(site)
      : defaultMessage(callSite)
  }

  // emit deprecation if listeners exist
  if (haslisteners) {
    var err = DeprecationError(this._namespace, message, stack.slice(i))
    process.emit('deprecation', err)
    return
  }

  // format and write message
  var format = process.stderr.isTTY
    ? formatColor
    : formatPlain
  var msg = format.call(this, message, caller, stack.slice(i))
  process.stderr.write(msg + '\n', 'utf8')

  return
}

/**
 * Get call site location as array.
 */

function callSiteLocation(callSite) {
  var file = callSite.getFileName() || '<anonymous>'
  var line = callSite.getLineNumber()
  var colm = callSite.getColumnNumber()

  if (callSite.isEval()) {
    file = callSite.getEvalOrigin() + ', ' + file
  }

  var site = [file, line, colm]

  site.callSite = callSite
  site.name = callSite.getFunctionName()

  return site
}

/**
 * Generate a default message from the site.
 */

function defaultMessage(site) {
  var callSite = site.callSite
  var funcName = site.name

  // make useful anonymous name
  if (!funcName) {
    funcName = '<anonymous@' + formatLocation(site) + '>'
  }

  var context = callSite.getThis()
  var typeName = context && callSite.getTypeName()

  // ignore useless type name
  if (typeName === 'Object') {
    typeName = undefined
  }

  // make useful type name
  if (typeName === 'Function') {
    typeName = context.name || typeName
  }

  return typeName && callSite.getMethodName()
    ? typeName + '.' + funcName
    : funcName
}

/**
 * Format deprecation message without color.
 */

function formatPlain(msg, caller, stack) {
  var timestamp = new Date().toUTCString()

  var formatted = timestamp
    + ' ' + this._namespace
    + ' deprecated ' + msg

  // add stack trace
  if (this._traced) {
    for (var i = 0; i < stack.length; i++) {
      formatted += '\n    at ' + callSiteToString(stack[i])
    }

    return formatted
  }

  if (caller) {
    formatted += ' at ' + formatLocation(caller)
  }

  return formatted
}

/**
 * Format deprecation message with color.
 */

function formatColor(msg, caller, stack) {
  var formatted = '\x1b[36;1m' + this._namespace + '\x1b[22;39m' // bold cyan
    + ' \x1b[33;1mdeprecated\x1b[22;39m' // bold yellow
    + ' \x1b[0m' + msg + '\x1b[39m' // reset

  // add stack trace
  if (this._traced) {
    for (var i = 0; i < stack.length; i++) {
      formatted += '\n    \x1b[36mat ' + callSiteToString(stack[i]) + '\x1b[39m' // cyan
    }

    return formatted
  }

  if (caller) {
    formatted += ' \x1b[36m' + formatLocation(caller) + '\x1b[39m' // cyan
  }

  return formatted
}

/**
 * Format call site location.
 */

function formatLocation(callSite) {
  return relative(basePath, callSite[0])
    + ':' + callSite[1]
    + ':' + callSite[2]
}

/**
 * Get the stack as array of call sites.
 */

function getStack() {
  var limit = Error.stackTraceLimit
  var obj = {}
  var prep = Error.prepareStackTrace

  Error.prepareStackTrace = prepareObjectStackTrace
  Error.stackTraceLimit = Math.max(10, limit)

  // capture the stack
  Error.captureStackTrace(obj)

  // slice this function off the top
  var stack = obj.stack.slice(1)

  Error.prepareStackTrace = prep
  Error.stackTraceLimit = limit

  return stack
}

/**
 * Capture call site stack from v8.
 */

function prepareObjectStackTrace(obj, stack) {
  return stack
}

/**
 * Return a wrapped function in a deprecation message.
 */

function wrapfunction(fn, message) {
  if (typeof fn !== 'function') {
    throw new TypeError('argument fn must be a function')
  }

  var args = createArgumentsString(fn.length)
  var deprecate = this
  var stack = getStack()
  var site = callSiteLocation(stack[1])

  site.name = fn.name

  var deprecatedfn = eval('(function (' + args + ') {\n'
    + '"use strict"\n'
    + 'log.call(deprecate, message, site)\n'
    + 'return fn.apply(this, arguments)\n'
    + '})')

  return deprecatedfn
}

/**
 * Wrap property in a deprecation message.
 */

function wrapproperty(obj, prop, message) {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
    throw new TypeError('argument obj must be object')
  }

  var descriptor = Object.getOwnPropertyDescriptor(obj, prop)

  if (!descriptor) {
    throw new TypeError('must call property on owner object')
  }

  if (!descriptor.configurable) {
    throw new TypeError('property must be configurable')
  }

  var deprecate = this
  var stack = getStack()
  var site = callSiteLocation(stack[1])

  // set site name
  site.name = prop

  // convert data descriptor
  if ('value' in descriptor) {
    descriptor = convertDataDescriptorToAccessor(obj, prop, message)
  }

  var get = descriptor.get
  var set = descriptor.set

  // wrap getter
  if (typeof get === 'function') {
    descriptor.get = function getter() {
      log.call(deprecate, message, site)
      return get.apply(this, arguments)
    }
  }

  // wrap setter
  if (typeof set === 'function') {
    descriptor.set = function setter() {
      log.call(deprecate, message, site)
      return set.apply(this, arguments)
    }
  }

  Object.defineProperty(obj, prop, descriptor)
}

/**
 * Create DeprecationError for deprecation
 */

function DeprecationError(namespace, message, stack) {
  var error = new Error()
  var stackString

  Object.defineProperty(error, 'constructor', {
    value: DeprecationError
  })

  Object.defineProperty(error, 'message', {
    configurable: true,
    enumerable: false,
    value: message,
    writable: true
  })

  Object.defineProperty(error, 'name', {
    enumerable: false,
    configurable: true,
    value: 'DeprecationError',
    writable: true
  })

  Object.defineProperty(error, 'namespace', {
    configurable: true,
    enumerable: false,
    value: namespace,
    writable: true
  })

  Object.defineProperty(error, 'stack', {
    configurable: true,
    enumerable: false,
    get: function () {
      if (stackString !== undefined) {
        return stackString
      }

      // prepare stack trace
      return stackString = createStackString.call(this, stack)
    },
    set: function setter(val) {
      stackString = val
    }
  })

  return error
}

}).call(this,require("g5I+bs"))
},{"./lib/compat":26,"events":33,"g5I+bs":37,"path":36}],24:[function(require,module,exports){
(function (Buffer){
/*!
 * depd
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * Module exports.
 */

module.exports = bufferConcat

/**
 * Concatenate an array of Buffers.
 */

function bufferConcat(bufs) {
  var length = 0

  for (var i = 0, len = bufs.length; i < len; i++) {
    length += bufs[i].length
  }

  var buf = new Buffer(length)
  var pos = 0

  for (var i = 0, len = bufs.length; i < len; i++) {
    bufs[i].copy(buf, pos)
    pos += bufs[i].length
  }

  return buf
}

}).call(this,require("buffer").Buffer)
},{"buffer":22}],25:[function(require,module,exports){
/*!
 * depd
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * Module exports.
 */

module.exports = callSiteToString

/**
 * Format a CallSite file location to a string.
 */

function callSiteFileLocation(callSite) {
  var fileName
  var fileLocation = ''

  if (callSite.isNative()) {
    fileLocation = 'native'
  } else if (callSite.isEval()) {
    fileName = callSite.getScriptNameOrSourceURL()
    if (!fileName) {
      fileLocation = callSite.getEvalOrigin()
    }
  } else {
    fileName = callSite.getFileName()
  }

  if (fileName) {
    fileLocation += fileName

    var lineNumber = callSite.getLineNumber()
    if (lineNumber != null) {
      fileLocation += ':' + lineNumber

      var columnNumber = callSite.getColumnNumber()
      if (columnNumber) {
        fileLocation += ':' + columnNumber
      }
    }
  }

  return fileLocation || 'unknown source'
}

/**
 * Format a CallSite to a string.
 */

function callSiteToString(callSite) {
  var addSuffix = true
  var fileLocation = callSiteFileLocation(callSite)
  var functionName = callSite.getFunctionName()
  var isConstructor = callSite.isConstructor()
  var isMethodCall = !(callSite.isToplevel() || isConstructor)
  var line = ''

  if (isMethodCall) {
    var methodName = callSite.getMethodName()
    var typeName = getConstructorName(callSite)

    if (functionName) {
      if (typeName && functionName.indexOf(typeName) !== 0) {
        line += typeName + '.'
      }

      line += functionName

      if (methodName && functionName.lastIndexOf('.' + methodName) !== functionName.length - methodName.length - 1) {
        line += ' [as ' + methodName + ']'
      }
    } else {
      line += typeName + '.' + (methodName || '<anonymous>')
    }
  } else if (isConstructor) {
    line += 'new ' + (functionName || '<anonymous>')
  } else if (functionName) {
    line += functionName
  } else {
    addSuffix = false
    line += fileLocation
  }

  if (addSuffix) {
    line += ' (' + fileLocation + ')'
  }

  return line
}

/**
 * Get constructor name of reviver.
 */

function getConstructorName(obj) {
  var receiver = obj.receiver
  return (receiver.constructor && receiver.constructor.name) || null
}

},{}],26:[function(require,module,exports){
(function (Buffer){
/*!
 * depd
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * Module exports.
 */

lazyProperty(module.exports, 'bufferConcat', function bufferConcat() {
  return Buffer.concat || require('./buffer-concat')
})

lazyProperty(module.exports, 'callSiteToString', function callSiteToString() {
  var limit = Error.stackTraceLimit
  var obj = {}
  var prep = Error.prepareStackTrace

  function prepareObjectStackTrace(obj, stack) {
    return stack
  }

  Error.prepareStackTrace = prepareObjectStackTrace
  Error.stackTraceLimit = 2

  // capture the stack
  Error.captureStackTrace(obj)

  // slice the stack
  var stack = obj.stack.slice()

  Error.prepareStackTrace = prep
  Error.stackTraceLimit = limit

  return stack[0].toString ? toString : require('./callsite-tostring')
})

/**
 * Define a lazy property.
 */

function lazyProperty(obj, prop, getter) {
  function get() {
    var val = getter()

    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: true,
      value: val
    })

    return val
  }

  Object.defineProperty(obj, prop, {
    configurable: true,
    enumerable: true,
    get: get
  })
}

/**
 * Call toString() on the obj
 */

function toString(obj) {
  return obj.toString()
}

}).call(this,require("buffer").Buffer)
},{"./buffer-concat":24,"./callsite-tostring":25,"buffer":22}],27:[function(require,module,exports){
(function (global){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
  Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
  Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
  Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
  Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*global exports:true, generateStatement:true, generateExpression:true, require:true, global:true*/
(function () {
    'use strict';

    var Syntax,
        Precedence,
        BinaryPrecedence,
        SourceNode,
        estraverse,
        esutils,
        isArray,
        base,
        indent,
        json,
        renumber,
        hexadecimal,
        quotes,
        escapeless,
        newline,
        space,
        parentheses,
        semicolons,
        safeConcatenation,
        directive,
        extra,
        parse,
        sourceMap,
        FORMAT_MINIFY,
        FORMAT_DEFAULTS;

    estraverse = require('estraverse');
    esutils = require('esutils');

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ComprehensionBlock: 'ComprehensionBlock',
        ComprehensionExpression: 'ComprehensionExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExportDeclaration: 'ExportDeclaration',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        ForOfStatement: 'ForOfStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        GeneratorExpression: 'GeneratorExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        ImportDeclaration: 'ImportDeclaration',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    Precedence = {
        Sequence: 0,
        Yield: 1,
        Assignment: 1,
        Conditional: 2,
        ArrowFunction: 2,
        LogicalOR: 3,
        LogicalAND: 4,
        BitwiseOR: 5,
        BitwiseXOR: 6,
        BitwiseAND: 7,
        Equality: 8,
        Relational: 9,
        BitwiseSHIFT: 10,
        Additive: 11,
        Multiplicative: 12,
        Unary: 13,
        Postfix: 14,
        Call: 15,
        New: 16,
        Member: 17,
        Primary: 18
    };

    BinaryPrecedence = {
        '||': Precedence.LogicalOR,
        '&&': Precedence.LogicalAND,
        '|': Precedence.BitwiseOR,
        '^': Precedence.BitwiseXOR,
        '&': Precedence.BitwiseAND,
        '==': Precedence.Equality,
        '!=': Precedence.Equality,
        '===': Precedence.Equality,
        '!==': Precedence.Equality,
        'is': Precedence.Equality,
        'isnt': Precedence.Equality,
        '<': Precedence.Relational,
        '>': Precedence.Relational,
        '<=': Precedence.Relational,
        '>=': Precedence.Relational,
        'in': Precedence.Relational,
        'instanceof': Precedence.Relational,
        '<<': Precedence.BitwiseSHIFT,
        '>>': Precedence.BitwiseSHIFT,
        '>>>': Precedence.BitwiseSHIFT,
        '+': Precedence.Additive,
        '-': Precedence.Additive,
        '*': Precedence.Multiplicative,
        '%': Precedence.Multiplicative,
        '/': Precedence.Multiplicative
    };

    function getDefaultOptions() {
        // default options
        return {
            indent: null,
            base: null,
            parse: null,
            comment: false,
            format: {
                indent: {
                    style: '    ',
                    base: 0,
                    adjustMultilineComment: false
                },
                newline: '\n',
                space: ' ',
                json: false,
                renumber: false,
                hexadecimal: false,
                quotes: 'single',
                escapeless: false,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: false
            },
            moz: {
                comprehensionExpressionStartsWithAssignment: false,
                starlessGenerator: false,
                parenthesizedComprehensionBlock: false
            },
            sourceMap: null,
            sourceMapRoot: null,
            sourceMapWithCode: false,
            directive: false,
            raw: true,
            verbatim: null
        };
    }

    function stringRepeat(str, num) {
        var result = '';

        for (num |= 0; num > 0; num >>>= 1, str += str) {
            if (num & 1) {
                result += str;
            }
        }

        return result;
    }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function hasLineTerminator(str) {
        return (/[\r\n]/g).test(str);
    }

    function endsWithLineTerminator(str) {
        var len = str.length;
        return len && esutils.code.isLineTerminator(str.charCodeAt(len - 1));
    }

    function updateDeeply(target, override) {
        var key, val;

        function isHashObject(target) {
            return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
        }

        for (key in override) {
            if (override.hasOwnProperty(key)) {
                val = override[key];
                if (isHashObject(val)) {
                    if (isHashObject(target[key])) {
                        updateDeeply(target[key], val);
                    } else {
                        target[key] = updateDeeply({}, val);
                    }
                } else {
                    target[key] = val;
                }
            }
        }
        return target;
    }

    function generateNumber(value) {
        var result, point, temp, exponent, pos;

        if (value !== value) {
            throw new Error('Numeric literal whose value is NaN');
        }
        if (value < 0 || (value === 0 && 1 / value < 0)) {
            throw new Error('Numeric literal whose value is negative');
        }

        if (value === 1 / 0) {
            return json ? 'null' : renumber ? '1e400' : '1e+400';
        }

        result = '' + value;
        if (!renumber || result.length < 3) {
            return result;
        }

        point = result.indexOf('.');
        if (!json && result.charCodeAt(0) === 0x30  /* 0 */ && point === 1) {
            point = 0;
            result = result.slice(1);
        }
        temp = result;
        result = result.replace('e+', 'e');
        exponent = 0;
        if ((pos = temp.indexOf('e')) > 0) {
            exponent = +temp.slice(pos + 1);
            temp = temp.slice(0, pos);
        }
        if (point >= 0) {
            exponent -= temp.length - point - 1;
            temp = +(temp.slice(0, point) + temp.slice(point + 1)) + '';
        }
        pos = 0;
        while (temp.charCodeAt(temp.length + pos - 1) === 0x30  /* 0 */) {
            --pos;
        }
        if (pos !== 0) {
            exponent -= pos;
            temp = temp.slice(0, pos);
        }
        if (exponent !== 0) {
            temp += 'e' + exponent;
        }
        if ((temp.length < result.length ||
                    (hexadecimal && value > 1e12 && Math.floor(value) === value && (temp = '0x' + value.toString(16)).length < result.length)) &&
                +temp === value) {
            result = temp;
        }

        return result;
    }

    // Generate valid RegExp expression.
    // This function is based on https://github.com/Constellation/iv Engine

    function escapeRegExpCharacter(ch, previousIsBackslash) {
        // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
        if ((ch & ~1) === 0x2028) {
            return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
        } else if (ch === 10 || ch === 13) {  // \n, \r
            return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
        }
        return String.fromCharCode(ch);
    }

    function generateRegExp(reg) {
        var match, result, flags, i, iz, ch, characterInBrack, previousIsBackslash;

        result = reg.toString();

        if (reg.source) {
            // extract flag from toString result
            match = result.match(/\/([^/]*)$/);
            if (!match) {
                return result;
            }

            flags = match[1];
            result = '';

            characterInBrack = false;
            previousIsBackslash = false;
            for (i = 0, iz = reg.source.length; i < iz; ++i) {
                ch = reg.source.charCodeAt(i);

                if (!previousIsBackslash) {
                    if (characterInBrack) {
                        if (ch === 93) {  // ]
                            characterInBrack = false;
                        }
                    } else {
                        if (ch === 47) {  // /
                            result += '\\';
                        } else if (ch === 91) {  // [
                            characterInBrack = true;
                        }
                    }
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    previousIsBackslash = ch === 92;  // \
                } else {
                    // if new RegExp("\\\n') is provided, create /\n/
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    // prevent like /\\[/]/
                    previousIsBackslash = false;
                }
            }

            return '/' + result + '/' + flags;
        }

        return result;
    }

    function escapeAllowedCharacter(code, next) {
        var hex, result = '\\';

        switch (code) {
        case 0x08  /* \b */:
            result += 'b';
            break;
        case 0x0C  /* \f */:
            result += 'f';
            break;
        case 0x09  /* \t */:
            result += 't';
            break;
        default:
            hex = code.toString(16).toUpperCase();
            if (json || code > 0xFF) {
                result += 'u' + '0000'.slice(hex.length) + hex;
            } else if (code === 0x0000 && !esutils.code.isDecimalDigit(next)) {
                result += '0';
            } else if (code === 0x000B  /* \v */) { // '\v'
                result += 'x0B';
            } else {
                result += 'x' + '00'.slice(hex.length) + hex;
            }
            break;
        }

        return result;
    }

    function escapeDisallowedCharacter(code) {
        var result = '\\';
        switch (code) {
        case 0x5C  /* \ */:
            result += '\\';
            break;
        case 0x0A  /* \n */:
            result += 'n';
            break;
        case 0x0D  /* \r */:
            result += 'r';
            break;
        case 0x2028:
            result += 'u2028';
            break;
        case 0x2029:
            result += 'u2029';
            break;
        default:
            throw new Error('Incorrectly classified character');
        }

        return result;
    }

    function escapeDirective(str) {
        var i, iz, code, quote;

        quote = quotes === 'double' ? '"' : '\'';
        for (i = 0, iz = str.length; i < iz; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                quote = '"';
                break;
            } else if (code === 0x22  /* " */) {
                quote = '\'';
                break;
            } else if (code === 0x5C  /* \ */) {
                ++i;
            }
        }

        return quote + str + quote;
    }

    function escapeString(str) {
        var result = '', i, len, code, singleQuotes = 0, doubleQuotes = 0, single, quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                ++singleQuotes;
            } else if (code === 0x22  /* " */) {
                ++doubleQuotes;
            } else if (code === 0x2F  /* / */ && json) {
                result += '\\';
            } else if (esutils.code.isLineTerminator(code) || code === 0x5C  /* \ */) {
                result += escapeDisallowedCharacter(code);
                continue;
            } else if ((json && code < 0x20  /* SP */) || !(json || escapeless || (code >= 0x20  /* SP */ && code <= 0x7E  /* ~ */))) {
                result += escapeAllowedCharacter(code, str.charCodeAt(i + 1));
                continue;
            }
            result += String.fromCharCode(code);
        }

        single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
        quote = single ? '\'' : '"';

        if (!(single ? singleQuotes : doubleQuotes)) {
            return quote + result + quote;
        }

        str = result;
        result = quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if ((code === 0x27  /* ' */ && single) || (code === 0x22  /* " */ && !single)) {
                result += '\\';
            }
            result += String.fromCharCode(code);
        }

        return result + quote;
    }

    /**
     * flatten an array to a string, where the array can contain
     * either strings or nested arrays
     */
    function flattenToString(arr) {
        var i, iz, elem, result = '';
        for (i = 0, iz = arr.length; i < iz; ++i) {
            elem = arr[i];
            result += isArray(elem) ? flattenToString(elem) : elem;
        }
        return result;
    }

    /**
     * convert generated to a SourceNode when source maps are enabled.
     */
    function toSourceNodeWhenNeeded(generated, node) {
        if (!sourceMap) {
            // with no source maps, generated is either an
            // array or a string.  if an array, flatten it.
            // if a string, just return it
            if (isArray(generated)) {
                return flattenToString(generated);
            } else {
                return generated;
            }
        }
        if (node == null) {
            if (generated instanceof SourceNode) {
                return generated;
            } else {
                node = {};
            }
        }
        if (node.loc == null) {
            return new SourceNode(null, null, sourceMap, generated, node.name || null);
        }
        return new SourceNode(node.loc.start.line, node.loc.start.column, (sourceMap === true ? node.loc.source || null : sourceMap), generated, node.name || null);
    }

    function noEmptySpace() {
        return (space) ? space : ' ';
    }

    function join(left, right) {
        var leftSource = toSourceNodeWhenNeeded(left).toString(),
            rightSource = toSourceNodeWhenNeeded(right).toString(),
            leftCharCode = leftSource.charCodeAt(leftSource.length - 1),
            rightCharCode = rightSource.charCodeAt(0);

        if ((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode ||
        esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode) ||
        leftCharCode === 0x2F  /* / */ && rightCharCode === 0x69  /* i */) { // infix word operators all start with `i`
            return [left, noEmptySpace(), right];
        } else if (esutils.code.isWhiteSpace(leftCharCode) || esutils.code.isLineTerminator(leftCharCode) ||
                esutils.code.isWhiteSpace(rightCharCode) || esutils.code.isLineTerminator(rightCharCode)) {
            return [left, right];
        }
        return [left, space, right];
    }

    function addIndent(stmt) {
        return [base, stmt];
    }

    function withIndent(fn) {
        var previousBase, result;
        previousBase = base;
        base += indent;
        result = fn.call(this, base);
        base = previousBase;
        return result;
    }

    function calculateSpaces(str) {
        var i;
        for (i = str.length - 1; i >= 0; --i) {
            if (esutils.code.isLineTerminator(str.charCodeAt(i))) {
                break;
            }
        }
        return (str.length - 1) - i;
    }

    function adjustMultilineComment(value, specialBase) {
        var array, i, len, line, j, spaces, previousBase, sn;

        array = value.split(/\r\n|[\r\n]/);
        spaces = Number.MAX_VALUE;

        // first line doesn't have indentation
        for (i = 1, len = array.length; i < len; ++i) {
            line = array[i];
            j = 0;
            while (j < line.length && esutils.code.isWhiteSpace(line.charCodeAt(j))) {
                ++j;
            }
            if (spaces > j) {
                spaces = j;
            }
        }

        if (typeof specialBase !== 'undefined') {
            // pattern like
            // {
            //   var t = 20;  /*
            //                 * this is comment
            //                 */
            // }
            previousBase = base;
            if (array[1][spaces] === '*') {
                specialBase += ' ';
            }
            base = specialBase;
        } else {
            if (spaces & 1) {
                // /*
                //  *
                //  */
                // If spaces are odd number, above pattern is considered.
                // We waste 1 space.
                --spaces;
            }
            previousBase = base;
        }

        for (i = 1, len = array.length; i < len; ++i) {
            sn = toSourceNodeWhenNeeded(addIndent(array[i].slice(spaces)));
            array[i] = sourceMap ? sn.join('') : sn;
        }

        base = previousBase;

        return array.join('\n');
    }

    function generateComment(comment, specialBase) {
        if (comment.type === 'Line') {
            if (endsWithLineTerminator(comment.value)) {
                return '//' + comment.value;
            } else {
                // Always use LineTerminator
                return '//' + comment.value + '\n';
            }
        }
        if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
            return adjustMultilineComment('/*' + comment.value + '*/', specialBase);
        }
        return '/*' + comment.value + '*/';
    }

    function addComments(stmt, result) {
        var i, len, comment, save, tailingToStatement, specialBase, fragment;

        if (stmt.leadingComments && stmt.leadingComments.length > 0) {
            save = result;

            comment = stmt.leadingComments[0];
            result = [];
            if (safeConcatenation && stmt.type === Syntax.Program && stmt.body.length === 0) {
                result.push('\n');
            }
            result.push(generateComment(comment));
            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push('\n');
            }

            for (i = 1, len = stmt.leadingComments.length; i < len; ++i) {
                comment = stmt.leadingComments[i];
                fragment = [generateComment(comment)];
                if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    fragment.push('\n');
                }
                result.push(addIndent(fragment));
            }

            result.push(addIndent(save));
        }

        if (stmt.trailingComments) {
            tailingToStatement = !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
            specialBase = stringRepeat(' ', calculateSpaces(toSourceNodeWhenNeeded([base, result, indent]).toString()));
            for (i = 0, len = stmt.trailingComments.length; i < len; ++i) {
                comment = stmt.trailingComments[i];
                if (tailingToStatement) {
                    // We assume target like following script
                    //
                    // var t = 20;  /**
                    //               * This is comment of t
                    //               */
                    if (i === 0) {
                        // first case
                        result = [result, indent];
                    } else {
                        result = [result, specialBase];
                    }
                    result.push(generateComment(comment, specialBase));
                } else {
                    result = [result, addIndent(generateComment(comment))];
                }
                if (i !== len - 1 && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result = [result, '\n'];
                }
            }
        }

        return result;
    }

    function parenthesize(text, current, should) {
        if (current < should) {
            return ['(', text, ')'];
        }
        return text;
    }

    function maybeBlock(stmt, semicolonOptional, functionBody) {
        var result, noLeadingComment;

        noLeadingComment = !extra.comment || !stmt.leadingComments;

        if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
            return [space, generateStatement(stmt, { functionBody: functionBody })];
        }

        if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
            return ';';
        }

        withIndent(function () {
            result = [newline, addIndent(generateStatement(stmt, { semicolonOptional: semicolonOptional, functionBody: functionBody }))];
        });

        return result;
    }

    function maybeBlockSuffix(stmt, result) {
        var ends = endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
        if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
            return [result, space];
        }
        if (ends) {
            return [result, base];
        }
        return [result, newline, base];
    }

    function generateVerbatimString(string) {
        var i, iz, result;
        result = string.split(/\r\n|\n/);
        for (i = 1, iz = result.length; i < iz; i++) {
            result[i] = newline + base + result[i];
        }
        return result;
    }

    function generateVerbatim(expr, option) {
        var verbatim, result, prec;
        verbatim = expr[extra.verbatim];

        if (typeof verbatim === 'string') {
            result = parenthesize(generateVerbatimString(verbatim), Precedence.Sequence, option.precedence);
        } else {
            // verbatim is object
            result = generateVerbatimString(verbatim.content);
            prec = (verbatim.precedence != null) ? verbatim.precedence : Precedence.Sequence;
            result = parenthesize(result, prec, option.precedence);
        }

        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateIdentifier(node) {
        return toSourceNodeWhenNeeded(node.name, node);
    }

    function generatePattern(node, options) {
        var result;

        if (node.type === Syntax.Identifier) {
            result = generateIdentifier(node);
        } else {
            result = generateExpression(node, {
                precedence: options.precedence,
                allowIn: options.allowIn,
                allowCall: true
            });
        }

        return result;
    }

    function generateFunctionBody(node) {
        var result, i, len, expr, arrow;

        arrow = node.type === Syntax.ArrowFunctionExpression;

        if (arrow && node.params.length === 1 && node.params[0].type === Syntax.Identifier) {
            // arg => { } case
            result = [generateIdentifier(node.params[0])];
        } else {
            result = ['('];
            for (i = 0, len = node.params.length; i < len; ++i) {
                result.push(generatePattern(node.params[i], {
                    precedence: Precedence.Assignment,
                    allowIn: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');
        }

        if (arrow) {
            result.push(space);
            result.push('=>');
        }

        if (node.expression) {
            result.push(space);
            expr = generateExpression(node.body, {
                precedence: Precedence.Assignment,
                allowIn: true,
                allowCall: true
            });
            if (expr.toString().charAt(0) === '{') {
                expr = ['(', expr, ')'];
            }
            result.push(expr);
        } else {
            result.push(maybeBlock(node.body, false, true));
        }
        return result;
    }

    function generateIterationForStatement(operator, stmt, semicolonIsNotNeeded) {
        var result = ['for' + space + '('];
        withIndent(function () {
            if (stmt.left.type === Syntax.VariableDeclaration) {
                withIndent(function () {
                    result.push(stmt.left.kind + noEmptySpace());
                    result.push(generateStatement(stmt.left.declarations[0], {
                        allowIn: false
                    }));
                });
            } else {
                result.push(generateExpression(stmt.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                }));
            }

            result = join(result, operator);
            result = [join(
                result,
                generateExpression(stmt.right, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), ')'];
        });
        result.push(maybeBlock(stmt.body, semicolonIsNotNeeded));
        return result;
    }

    function generateLiteral(expr) {
        var raw;
        if (expr.hasOwnProperty('raw') && parse && extra.raw) {
            try {
                raw = parse(expr.raw).body[0].expression;
                if (raw.type === Syntax.Literal) {
                    if (raw.value === expr.value) {
                        return expr.raw;
                    }
                }
            } catch (e) {
                // not use raw property
            }
        }

        if (expr.value === null) {
            return 'null';
        }

        if (typeof expr.value === 'string') {
            return escapeString(expr.value);
        }

        if (typeof expr.value === 'number') {
            return generateNumber(expr.value);
        }

        if (typeof expr.value === 'boolean') {
            return expr.value ? 'true' : 'false';
        }

        return generateRegExp(expr.value);
    }

    function generateExpression(expr, option) {
        var result,
            precedence,
            type,
            currentPrecedence,
            i,
            len,
            fragment,
            multiline,
            leftCharCode,
            leftSource,
            rightCharCode,
            allowIn,
            allowCall,
            allowUnparenthesizedNew,
            property,
            isGenerator;

        precedence = option.precedence;
        allowIn = option.allowIn;
        allowCall = option.allowCall;
        type = expr.type || option.type;

        if (extra.verbatim && expr.hasOwnProperty(extra.verbatim)) {
            return generateVerbatim(expr, option);
        }

        switch (type) {
        case Syntax.SequenceExpression:
            result = [];
            allowIn |= (Precedence.Sequence < precedence);
            for (i = 0, len = expr.expressions.length; i < len; ++i) {
                result.push(generateExpression(expr.expressions[i], {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result = parenthesize(result, Precedence.Sequence, precedence);
            break;

        case Syntax.AssignmentExpression:
            allowIn |= (Precedence.Assignment < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.left, {
                        precedence: Precedence.Call,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + expr.operator + space,
                    generateExpression(expr.right, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Assignment,
                precedence
            );
            break;

        case Syntax.ArrowFunctionExpression:
            allowIn |= (Precedence.ArrowFunction < precedence);
            result = parenthesize(generateFunctionBody(expr), Precedence.ArrowFunction, precedence);
            break;

        case Syntax.ConditionalExpression:
            allowIn |= (Precedence.Conditional < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.test, {
                        precedence: Precedence.LogicalOR,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + '?' + space,
                    generateExpression(expr.consequent, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + ':' + space,
                    generateExpression(expr.alternate, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Conditional,
                precedence
            );
            break;

        case Syntax.LogicalExpression:
        case Syntax.BinaryExpression:
            currentPrecedence = BinaryPrecedence[expr.operator];

            allowIn |= (currentPrecedence < precedence);

            fragment = generateExpression(expr.left, {
                precedence: currentPrecedence,
                allowIn: allowIn,
                allowCall: true
            });

            leftSource = fragment.toString();

            if (leftSource.charCodeAt(leftSource.length - 1) === 0x2F /* / */ && esutils.code.isIdentifierPart(expr.operator.charCodeAt(0))) {
                result = [fragment, noEmptySpace(), expr.operator];
            } else {
                result = join(fragment, expr.operator);
            }

            fragment = generateExpression(expr.right, {
                precedence: currentPrecedence + 1,
                allowIn: allowIn,
                allowCall: true
            });

            if (expr.operator === '/' && fragment.toString().charAt(0) === '/' ||
            expr.operator.slice(-1) === '<' && fragment.toString().slice(0, 3) === '!--') {
                // If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
                result.push(noEmptySpace());
                result.push(fragment);
            } else {
                result = join(result, fragment);
            }

            if (expr.operator === 'in' && !allowIn) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, currentPrecedence, precedence);
            }

            break;

        case Syntax.CallExpression:
            result = [generateExpression(expr.callee, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: true,
                allowUnparenthesizedNew: false
            })];

            result.push('(');
            for (i = 0, len = expr['arguments'].length; i < len; ++i) {
                result.push(generateExpression(expr['arguments'][i], {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');

            if (!allowCall) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, Precedence.Call, precedence);
            }
            break;

        case Syntax.NewExpression:
            len = expr['arguments'].length;
            allowUnparenthesizedNew = option.allowUnparenthesizedNew === undefined || option.allowUnparenthesizedNew;

            result = join(
                'new',
                generateExpression(expr.callee, {
                    precedence: Precedence.New,
                    allowIn: true,
                    allowCall: false,
                    allowUnparenthesizedNew: allowUnparenthesizedNew && !parentheses && len === 0
                })
            );

            if (!allowUnparenthesizedNew || parentheses || len > 0) {
                result.push('(');
                for (i = 0; i < len; ++i) {
                    result.push(generateExpression(expr['arguments'][i], {
                        precedence: Precedence.Assignment,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + space);
                    }
                }
                result.push(')');
            }

            result = parenthesize(result, Precedence.New, precedence);
            break;

        case Syntax.MemberExpression:
            result = [generateExpression(expr.object, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: allowCall,
                allowUnparenthesizedNew: false
            })];

            if (expr.computed) {
                result.push('[');
                result.push(generateExpression(expr.property, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: allowCall
                }));
                result.push(']');
            } else {
                if (expr.object.type === Syntax.Literal && typeof expr.object.value === 'number') {
                    fragment = toSourceNodeWhenNeeded(result).toString();
                    // When the following conditions are all true,
                    //   1. No floating point
                    //   2. Don't have exponents
                    //   3. The last character is a decimal digit
                    //   4. Not hexadecimal OR octal number literal
                    // we should add a floating point.
                    if (
                            fragment.indexOf('.') < 0 &&
                            !/[eExX]/.test(fragment) &&
                            esutils.code.isDecimalDigit(fragment.charCodeAt(fragment.length - 1)) &&
                            !(fragment.length >= 2 && fragment.charCodeAt(0) === 48)  // '0'
                            ) {
                        result.push('.');
                    }
                }
                result.push('.');
                result.push(generateIdentifier(expr.property));
            }

            result = parenthesize(result, Precedence.Member, precedence);
            break;

        case Syntax.UnaryExpression:
            fragment = generateExpression(expr.argument, {
                precedence: Precedence.Unary,
                allowIn: true,
                allowCall: true
            });

            if (space === '') {
                result = join(expr.operator, fragment);
            } else {
                result = [expr.operator];
                if (expr.operator.length > 2) {
                    // delete, void, typeof
                    // get `typeof []`, not `typeof[]`
                    result = join(result, fragment);
                } else {
                    // Prevent inserting spaces between operator and argument if it is unnecessary
                    // like, `!cond`
                    leftSource = toSourceNodeWhenNeeded(result).toString();
                    leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
                    rightCharCode = fragment.toString().charCodeAt(0);

                    if (((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode) ||
                            (esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode))) {
                        result.push(noEmptySpace());
                        result.push(fragment);
                    } else {
                        result.push(fragment);
                    }
                }
            }
            result = parenthesize(result, Precedence.Unary, precedence);
            break;

        case Syntax.YieldExpression:
            if (expr.delegate) {
                result = 'yield*';
            } else {
                result = 'yield';
            }
            if (expr.argument) {
                result = join(
                    result,
                    generateExpression(expr.argument, {
                        precedence: Precedence.Yield,
                        allowIn: true,
                        allowCall: true
                    })
                );
            }
            result = parenthesize(result, Precedence.Yield, precedence);
            break;

        case Syntax.UpdateExpression:
            if (expr.prefix) {
                result = parenthesize(
                    [
                        expr.operator,
                        generateExpression(expr.argument, {
                            precedence: Precedence.Unary,
                            allowIn: true,
                            allowCall: true
                        })
                    ],
                    Precedence.Unary,
                    precedence
                );
            } else {
                result = parenthesize(
                    [
                        generateExpression(expr.argument, {
                            precedence: Precedence.Postfix,
                            allowIn: true,
                            allowCall: true
                        }),
                        expr.operator
                    ],
                    Precedence.Postfix,
                    precedence
                );
            }
            break;

        case Syntax.FunctionExpression:
            isGenerator = expr.generator && !extra.moz.starlessGenerator;
            result = isGenerator ? 'function*' : 'function';

            if (expr.id) {
                result = [result, (isGenerator) ? space : noEmptySpace(),
                          generateIdentifier(expr.id),
                          generateFunctionBody(expr)];
            } else {
                result = [result + space, generateFunctionBody(expr)];
            }

            break;

        case Syntax.ArrayPattern:
        case Syntax.ArrayExpression:
            if (!expr.elements.length) {
                result = '[]';
                break;
            }
            multiline = expr.elements.length > 1;
            result = ['[', multiline ? newline : ''];
            withIndent(function (indent) {
                for (i = 0, len = expr.elements.length; i < len; ++i) {
                    if (!expr.elements[i]) {
                        if (multiline) {
                            result.push(indent);
                        }
                        if (i + 1 === len) {
                            result.push(',');
                        }
                    } else {
                        result.push(multiline ? indent : '');
                        result.push(generateExpression(expr.elements[i], {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        }));
                    }
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });
            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push(']');
            break;

        case Syntax.Property:
            if (expr.kind === 'get' || expr.kind === 'set') {
                result = [
                    expr.kind, noEmptySpace(),
                    generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    generateFunctionBody(expr.value)
                ];
            } else {
                if (expr.shorthand) {
                    result = generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });
                } else if (expr.method) {
                    result = [];
                    if (expr.value.generator) {
                        result.push('*');
                    }
                    result.push(generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(generateFunctionBody(expr.value));
                } else {
                    result = [
                        generateExpression(expr.key, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        }),
                        ':' + space,
                        generateExpression(expr.value, {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        })
                    ];
                }
            }
            break;

        case Syntax.ObjectExpression:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }
            multiline = expr.properties.length > 1;

            withIndent(function () {
                fragment = generateExpression(expr.properties[0], {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true,
                    type: Syntax.Property
                });
            });

            if (!multiline) {
                // issues 4
                // Do not transform from
                //   dejavu.Class.declare({
                //       method2: function () {}
                //   });
                // to
                //   dejavu.Class.declare({method2: function () {
                //       }});
                if (!hasLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result = [ '{', space, fragment, space, '}' ];
                    break;
                }
            }

            withIndent(function (indent) {
                result = [ '{', newline, indent, fragment ];

                if (multiline) {
                    result.push(',' + newline);
                    for (i = 1, len = expr.properties.length; i < len; ++i) {
                        result.push(indent);
                        result.push(generateExpression(expr.properties[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true,
                            type: Syntax.Property
                        }));
                        if (i + 1 < len) {
                            result.push(',' + newline);
                        }
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(base);
            result.push('}');
            break;

        case Syntax.ObjectPattern:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }

            multiline = false;
            if (expr.properties.length === 1) {
                property = expr.properties[0];
                if (property.value.type !== Syntax.Identifier) {
                    multiline = true;
                }
            } else {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    property = expr.properties[i];
                    if (!property.shorthand) {
                        multiline = true;
                        break;
                    }
                }
            }
            result = ['{', multiline ? newline : '' ];

            withIndent(function (indent) {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    result.push(multiline ? indent : '');
                    result.push(generateExpression(expr.properties[i], {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });

            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push('}');
            break;

        case Syntax.ThisExpression:
            result = 'this';
            break;

        case Syntax.Identifier:
            result = generateIdentifier(expr);
            break;

        case Syntax.Literal:
            result = generateLiteral(expr);
            break;

        case Syntax.GeneratorExpression:
        case Syntax.ComprehensionExpression:
            // GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
            // Due to https://bugzilla.mozilla.org/show_bug.cgi?id=883468 position of expr.body can differ in Spidermonkey and ES6
            result = (type === Syntax.GeneratorExpression) ? ['('] : ['['];

            if (extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result.push(fragment);
            }

            if (expr.blocks) {
                withIndent(function () {
                    for (i = 0, len = expr.blocks.length; i < len; ++i) {
                        fragment = generateExpression(expr.blocks[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        });

                        if (i > 0 || extra.moz.comprehensionExpressionStartsWithAssignment) {
                            result = join(result, fragment);
                        } else {
                            result.push(fragment);
                        }
                    }
                });
            }

            if (expr.filter) {
                result = join(result, 'if' + space);
                fragment = generateExpression(expr.filter, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                });
                if (extra.moz.parenthesizedComprehensionBlock) {
                    result = join(result, [ '(', fragment, ')' ]);
                } else {
                    result = join(result, fragment);
                }
            }

            if (!extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result = join(result, fragment);
            }

            result.push((type === Syntax.GeneratorExpression) ? ')' : ']');
            break;

        case Syntax.ComprehensionBlock:
            if (expr.left.type === Syntax.VariableDeclaration) {
                fragment = [
                    expr.left.kind, noEmptySpace(),
                    generateStatement(expr.left.declarations[0], {
                        allowIn: false
                    })
                ];
            } else {
                fragment = generateExpression(expr.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                });
            }

            fragment = join(fragment, expr.of ? 'of' : 'in');
            fragment = join(fragment, generateExpression(expr.right, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            }));

            if (extra.moz.parenthesizedComprehensionBlock) {
                result = [ 'for' + space + '(', fragment, ')' ];
            } else {
                result = join('for' + space, fragment);
            }
            break;

        default:
            throw new Error('Unknown expression type: ' + expr.type);
        }

        if (extra.comment) {
            result = addComments(expr,result);
        }
        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateStatement(stmt, option) {
        var i,
            len,
            result,
            node,
            specifier,
            allowIn,
            functionBody,
            directiveContext,
            fragment,
            semicolon,
            isGenerator;

        allowIn = true;
        semicolon = ';';
        functionBody = false;
        directiveContext = false;
        if (option) {
            allowIn = option.allowIn === undefined || option.allowIn;
            if (!semicolons && option.semicolonOptional === true) {
                semicolon = '';
            }
            functionBody = option.functionBody;
            directiveContext = option.directiveContext;
        }

        switch (stmt.type) {
        case Syntax.BlockStatement:
            result = ['{', newline];

            withIndent(function () {
                for (i = 0, len = stmt.body.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.body[i], {
                        semicolonOptional: i === len - 1,
                        directiveContext: functionBody
                    }));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });

            result.push(addIndent('}'));
            break;

        case Syntax.BreakStatement:
            if (stmt.label) {
                result = 'break ' + stmt.label.name + semicolon;
            } else {
                result = 'break' + semicolon;
            }
            break;

        case Syntax.ContinueStatement:
            if (stmt.label) {
                result = 'continue ' + stmt.label.name + semicolon;
            } else {
                result = 'continue' + semicolon;
            }
            break;

        case Syntax.DirectiveStatement:
            if (extra.raw && stmt.raw) {
                result = stmt.raw + semicolon;
            } else {
                result = escapeDirective(stmt.directive) + semicolon;
            }
            break;

        case Syntax.DoWhileStatement:
            // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
            result = join('do', maybeBlock(stmt.body));
            result = maybeBlockSuffix(stmt.body, result);
            result = join(result, [
                'while' + space + '(',
                generateExpression(stmt.test, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                }),
                ')' + semicolon
            ]);
            break;

        case Syntax.CatchClause:
            withIndent(function () {
                var guard;

                result = [
                    'catch' + space + '(',
                    generateExpression(stmt.param, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];

                if (stmt.guard) {
                    guard = generateExpression(stmt.guard, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });

                    result.splice(2, 0, ' if ', guard);
                }
            });
            result.push(maybeBlock(stmt.body));
            break;

        case Syntax.DebuggerStatement:
            result = 'debugger' + semicolon;
            break;

        case Syntax.EmptyStatement:
            result = ';';
            break;

        case Syntax.ExportDeclaration:
            result = 'export ';
            if (stmt.declaration) {
                // FunctionDeclaration or VariableDeclaration
                result = [result, generateStatement(stmt.declaration, { semicolonOptional: semicolon === '' })];
                break;
            }
            break;

        case Syntax.ExpressionStatement:
            result = [generateExpression(stmt.expression, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            })];
            // 12.4 '{', 'function' is not allowed in this position.
            // wrap expression with parentheses
            fragment = toSourceNodeWhenNeeded(result).toString();
            if (fragment.charAt(0) === '{' ||  // ObjectExpression
                    (fragment.slice(0, 8) === 'function' && '* ('.indexOf(fragment.charAt(8)) >= 0) ||  // function or generator
                    (directive && directiveContext && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                result = ['(', result, ')' + semicolon];
            } else {
                result.push(semicolon);
            }
            break;

        case Syntax.ImportDeclaration:
            // ES6: 15.2.1 valid import declarations:
            //     - import ImportClause FromClause ;
            //     - import ModuleSpecifier ;
            // If no ImportClause is present,
            // this should be `import ModuleSpecifier` so skip `from`
            //
            // ModuleSpecifier is StringLiteral.
            if (stmt.specifiers.length === 0) {
                // import ModuleSpecifier ;
                result = [
                    'import',
                    space,
                    generateLiteral(stmt.source)
                ];
            } else {
                // import ImportClause FromClause ;
                if (stmt.kind === 'default') {
                    // import ... from "...";
                    result = [
                        'import',
                        noEmptySpace(),
                        stmt.specifiers[0].id.name,
                        noEmptySpace()
                    ];
                } else {
                    // stmt.kind === 'named'
                    result = [
                        'import',
                        space,
                        '{',
                    ];

                    if (stmt.specifiers.length === 1) {
                        // import { ... } from "...";
                        specifier = stmt.specifiers[0];
                        result.push(space + specifier.id.name);
                        if (specifier.name) {
                            result.push(noEmptySpace() + 'as' + noEmptySpace() + specifier.name.name);
                        }
                        result.push(space + '}' + space);
                    } else {
                        // import {
                        //    ...,
                        //    ...,
                        // } from "...";
                        withIndent(function (indent) {
                            var i, iz;
                            result.push(newline);
                            for (i = 0, iz = stmt.specifiers.length; i < iz; ++i) {
                                specifier = stmt.specifiers[i];
                                result.push(indent + specifier.id.name);
                                if (specifier.name) {
                                    result.push(noEmptySpace() + 'as' + noEmptySpace() + specifier.name.name);
                                }

                                if (i + 1 < iz) {
                                    result.push(',' + newline);
                                }
                            }
                        });
                        if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                            result.push(newline);
                        }
                        result.push(base + '}' + space);
                    }
                }

                result.push('from' + space);
                result.push(generateLiteral(stmt.source));
            }
            result.push(semicolon);
            break;

        case Syntax.VariableDeclarator:
            if (stmt.init) {
                result = [
                    generateExpression(stmt.id, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space,
                    '=',
                    space,
                    generateExpression(stmt.init, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ];
            } else {
                result = generatePattern(stmt.id, {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn
                });
            }
            break;

        case Syntax.VariableDeclaration:
            result = [stmt.kind];
            // special path for
            // var x = function () {
            // };
            if (stmt.declarations.length === 1 && stmt.declarations[0].init &&
                    stmt.declarations[0].init.type === Syntax.FunctionExpression) {
                result.push(noEmptySpace());
                result.push(generateStatement(stmt.declarations[0], {
                    allowIn: allowIn
                }));
            } else {
                // VariableDeclarator is typed as Statement,
                // but joined with comma (not LineTerminator).
                // So if comment is attached to target node, we should specialize.
                withIndent(function () {
                    node = stmt.declarations[0];
                    if (extra.comment && node.leadingComments) {
                        result.push('\n');
                        result.push(addIndent(generateStatement(node, {
                            allowIn: allowIn
                        })));
                    } else {
                        result.push(noEmptySpace());
                        result.push(generateStatement(node, {
                            allowIn: allowIn
                        }));
                    }

                    for (i = 1, len = stmt.declarations.length; i < len; ++i) {
                        node = stmt.declarations[i];
                        if (extra.comment && node.leadingComments) {
                            result.push(',' + newline);
                            result.push(addIndent(generateStatement(node, {
                                allowIn: allowIn
                            })));
                        } else {
                            result.push(',' + space);
                            result.push(generateStatement(node, {
                                allowIn: allowIn
                            }));
                        }
                    }
                });
            }
            result.push(semicolon);
            break;

        case Syntax.ThrowStatement:
            result = [join(
                'throw',
                generateExpression(stmt.argument, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), semicolon];
            break;

        case Syntax.TryStatement:
            result = ['try', maybeBlock(stmt.block)];
            result = maybeBlockSuffix(stmt.block, result);

            if (stmt.handlers) {
                // old interface
                for (i = 0, len = stmt.handlers.length; i < len; ++i) {
                    result = join(result, generateStatement(stmt.handlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.handlers[i].body, result);
                    }
                }
            } else {
                stmt.guardedHandlers = stmt.guardedHandlers || [];

                for (i = 0, len = stmt.guardedHandlers.length; i < len; ++i) {
                    result = join(result, generateStatement(stmt.guardedHandlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.guardedHandlers[i].body, result);
                    }
                }

                // new interface
                if (stmt.handler) {
                    if (isArray(stmt.handler)) {
                        for (i = 0, len = stmt.handler.length; i < len; ++i) {
                            result = join(result, generateStatement(stmt.handler[i]));
                            if (stmt.finalizer || i + 1 !== len) {
                                result = maybeBlockSuffix(stmt.handler[i].body, result);
                            }
                        }
                    } else {
                        result = join(result, generateStatement(stmt.handler));
                        if (stmt.finalizer) {
                            result = maybeBlockSuffix(stmt.handler.body, result);
                        }
                    }
                }
            }
            if (stmt.finalizer) {
                result = join(result, ['finally', maybeBlock(stmt.finalizer)]);
            }
            break;

        case Syntax.SwitchStatement:
            withIndent(function () {
                result = [
                    'switch' + space + '(',
                    generateExpression(stmt.discriminant, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')' + space + '{' + newline
                ];
            });
            if (stmt.cases) {
                for (i = 0, len = stmt.cases.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.cases[i], {semicolonOptional: i === len - 1}));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            }
            result.push(addIndent('}'));
            break;

        case Syntax.SwitchCase:
            withIndent(function () {
                if (stmt.test) {
                    result = [
                        join('case', generateExpression(stmt.test, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        })),
                        ':'
                    ];
                } else {
                    result = ['default:'];
                }

                i = 0;
                len = stmt.consequent.length;
                if (len && stmt.consequent[0].type === Syntax.BlockStatement) {
                    fragment = maybeBlock(stmt.consequent[0]);
                    result.push(fragment);
                    i = 1;
                }

                if (i !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result.push(newline);
                }

                for (; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.consequent[i], {semicolonOptional: i === len - 1 && semicolon === ''}));
                    result.push(fragment);
                    if (i + 1 !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });
            break;

        case Syntax.IfStatement:
            withIndent(function () {
                result = [
                    'if' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            if (stmt.alternate) {
                result.push(maybeBlock(stmt.consequent));
                result = maybeBlockSuffix(stmt.consequent, result);
                if (stmt.alternate.type === Syntax.IfStatement) {
                    result = join(result, ['else ', generateStatement(stmt.alternate, {semicolonOptional: semicolon === ''})]);
                } else {
                    result = join(result, join('else', maybeBlock(stmt.alternate, semicolon === '')));
                }
            } else {
                result.push(maybeBlock(stmt.consequent, semicolon === ''));
            }
            break;

        case Syntax.ForStatement:
            withIndent(function () {
                result = ['for' + space + '('];
                if (stmt.init) {
                    if (stmt.init.type === Syntax.VariableDeclaration) {
                        result.push(generateStatement(stmt.init, {allowIn: false}));
                    } else {
                        result.push(generateExpression(stmt.init, {
                            precedence: Precedence.Sequence,
                            allowIn: false,
                            allowCall: true
                        }));
                        result.push(';');
                    }
                } else {
                    result.push(';');
                }

                if (stmt.test) {
                    result.push(space);
                    result.push(generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(';');
                } else {
                    result.push(';');
                }

                if (stmt.update) {
                    result.push(space);
                    result.push(generateExpression(stmt.update, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(')');
                } else {
                    result.push(')');
                }
            });

            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.ForInStatement:
            result = generateIterationForStatement('in', stmt, semicolon === '');
            break;

        case Syntax.ForOfStatement:
            result = generateIterationForStatement('of', stmt, semicolon === '');
            break;

        case Syntax.LabeledStatement:
            result = [stmt.label.name + ':', maybeBlock(stmt.body, semicolon === '')];
            break;

        case Syntax.Program:
            len = stmt.body.length;
            result = [safeConcatenation && len > 0 ? '\n' : ''];
            for (i = 0; i < len; ++i) {
                fragment = addIndent(
                    generateStatement(stmt.body[i], {
                        semicolonOptional: !safeConcatenation && i === len - 1,
                        directiveContext: true
                    })
                );
                result.push(fragment);
                if (i + 1 < len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result.push(newline);
                }
            }
            break;

        case Syntax.FunctionDeclaration:
            isGenerator = stmt.generator && !extra.moz.starlessGenerator;
            result = [
                (isGenerator ? 'function*' : 'function'),
                (isGenerator ? space : noEmptySpace()),
                generateIdentifier(stmt.id),
                generateFunctionBody(stmt)
            ];
            break;

        case Syntax.ReturnStatement:
            if (stmt.argument) {
                result = [join(
                    'return',
                    generateExpression(stmt.argument, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    })
                ), semicolon];
            } else {
                result = ['return' + semicolon];
            }
            break;

        case Syntax.WhileStatement:
            withIndent(function () {
                result = [
                    'while' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.WithStatement:
            withIndent(function () {
                result = [
                    'with' + space + '(',
                    generateExpression(stmt.object, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        default:
            throw new Error('Unknown statement type: ' + stmt.type);
        }

        // Attach comments

        if (extra.comment) {
            result = addComments(stmt, result);
        }

        fragment = toSourceNodeWhenNeeded(result).toString();
        if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
            result = sourceMap ? toSourceNodeWhenNeeded(result).replaceRight(/\s+$/, '') : fragment.replace(/\s+$/, '');
        }

        return toSourceNodeWhenNeeded(result, stmt);
    }

    function generate(node, options) {
        var defaultOptions = getDefaultOptions(), result, pair;

        if (options != null) {
            // Obsolete options
            //
            //   `options.indent`
            //   `options.base`
            //
            // Instead of them, we can use `option.format.indent`.
            if (typeof options.indent === 'string') {
                defaultOptions.format.indent.style = options.indent;
            }
            if (typeof options.base === 'number') {
                defaultOptions.format.indent.base = options.base;
            }
            options = updateDeeply(defaultOptions, options);
            indent = options.format.indent.style;
            if (typeof options.base === 'string') {
                base = options.base;
            } else {
                base = stringRepeat(indent, options.format.indent.base);
            }
        } else {
            options = defaultOptions;
            indent = options.format.indent.style;
            base = stringRepeat(indent, options.format.indent.base);
        }
        json = options.format.json;
        renumber = options.format.renumber;
        hexadecimal = json ? false : options.format.hexadecimal;
        quotes = json ? 'double' : options.format.quotes;
        escapeless = options.format.escapeless;
        newline = options.format.newline;
        space = options.format.space;
        if (options.format.compact) {
            newline = space = indent = base = '';
        }
        parentheses = options.format.parentheses;
        semicolons = options.format.semicolons;
        safeConcatenation = options.format.safeConcatenation;
        directive = options.directive;
        parse = json ? null : options.parse;
        sourceMap = options.sourceMap;
        extra = options;

        if (sourceMap) {
            if (!exports.browser) {
                // We assume environment is node.js
                // And prevent from including source-map by browserify
                SourceNode = require('source-map').SourceNode;
            } else {
                SourceNode = global.sourceMap.SourceNode;
            }
        }

        switch (node.type) {
        case Syntax.BlockStatement:
        case Syntax.BreakStatement:
        case Syntax.CatchClause:
        case Syntax.ContinueStatement:
        case Syntax.DirectiveStatement:
        case Syntax.DoWhileStatement:
        case Syntax.DebuggerStatement:
        case Syntax.EmptyStatement:
        case Syntax.ExpressionStatement:
        case Syntax.ForStatement:
        case Syntax.ForInStatement:
        case Syntax.ForOfStatement:
        case Syntax.FunctionDeclaration:
        case Syntax.IfStatement:
        case Syntax.LabeledStatement:
        case Syntax.Program:
        case Syntax.ReturnStatement:
        case Syntax.SwitchStatement:
        case Syntax.SwitchCase:
        case Syntax.ThrowStatement:
        case Syntax.TryStatement:
        case Syntax.VariableDeclaration:
        case Syntax.VariableDeclarator:
        case Syntax.WhileStatement:
        case Syntax.WithStatement:
            result = generateStatement(node);
            break;

        case Syntax.AssignmentExpression:
        case Syntax.ArrayExpression:
        case Syntax.ArrayPattern:
        case Syntax.BinaryExpression:
        case Syntax.CallExpression:
        case Syntax.ConditionalExpression:
        case Syntax.FunctionExpression:
        case Syntax.Identifier:
        case Syntax.Literal:
        case Syntax.LogicalExpression:
        case Syntax.MemberExpression:
        case Syntax.NewExpression:
        case Syntax.ObjectExpression:
        case Syntax.ObjectPattern:
        case Syntax.Property:
        case Syntax.SequenceExpression:
        case Syntax.ThisExpression:
        case Syntax.UnaryExpression:
        case Syntax.UpdateExpression:
        case Syntax.YieldExpression:

            result = generateExpression(node, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            });
            break;

        default:
            throw new Error('Unknown node type: ' + node.type);
        }

        if (!sourceMap) {
            pair = {code: result.toString(), map: null};
            return options.sourceMapWithCode ? pair : pair.code;
        }


        pair = result.toStringWithSourceMap({
            file: options.file,
            sourceRoot: options.sourceMapRoot
        });

        if (options.sourceContent) {
            pair.map.setSourceContent(options.sourceMap,
                                      options.sourceContent);
        }

        if (options.sourceMapWithCode) {
            return pair;
        }

        return pair.map.toString();
    }

    FORMAT_MINIFY = {
        indent: {
            style: '',
            base: 0
        },
        renumber: true,
        hexadecimal: true,
        quotes: 'auto',
        escapeless: true,
        compact: true,
        parentheses: false,
        semicolons: false
    };

    FORMAT_DEFAULTS = getDefaultOptions().format;

    exports.version = require('./package.json').version;
    exports.generate = generate;
    exports.attachComments = estraverse.attachComments;
    exports.Precedence = updateDeeply({}, Precedence);
    exports.browser = false;
    exports.FORMAT_MINIFY = FORMAT_MINIFY;
    exports.FORMAT_DEFAULTS = FORMAT_DEFAULTS;
}());
/* vim: set sw=4 ts=4 et tw=80 : */

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./package.json":28,"estraverse":29,"esutils":32,"source-map":38}],28:[function(require,module,exports){
module.exports={
  "_args": [
    [
      "escodegen@~1.3.2",
      "/home/oni/iota"
    ]
  ],
  "_from": "escodegen@>=1.3.2 <1.4.0",
  "_id": "escodegen@1.3.3",
  "_inCache": true,
  "_installable": true,
  "_location": "/escodegen",
  "_npmUser": {
    "email": "utatane.tea@gmail.com",
    "name": "constellation"
  },
  "_npmVersion": "1.4.3",
  "_phantomChildren": {},
  "_requested": {
    "name": "escodegen",
    "raw": "escodegen@~1.3.2",
    "rawSpec": "~1.3.2",
    "scope": null,
    "spec": ">=1.3.2 <1.4.0",
    "type": "range"
  },
  "_requiredBy": [
    "/"
  ],
  "_resolved": "https://registry.npmjs.org/escodegen/-/escodegen-1.3.3.tgz",
  "_shasum": "f024016f5a88e046fd12005055e939802e6c5f23",
  "_shrinkwrap": null,
  "_spec": "escodegen@~1.3.2",
  "_where": "/home/oni/iota",
  "bin": {
    "escodegen": "./bin/escodegen.js",
    "esgenerate": "./bin/esgenerate.js"
  },
  "bugs": {
    "url": "https://github.com/Constellation/escodegen/issues"
  },
  "dependencies": {
    "esprima": "~1.1.1",
    "estraverse": "~1.5.0",
    "esutils": "~1.0.0",
    "source-map": "~0.1.33"
  },
  "description": "ECMAScript code generator",
  "devDependencies": {
    "bluebird": "~1.2.0",
    "bower-registry-client": "~0.2.0",
    "chai": "~1.7.2",
    "commonjs-everywhere": "~0.9.6",
    "esprima-moz": "*",
    "gulp": "~3.5.0",
    "gulp-eslint": "~0.1.2",
    "gulp-jshint": "~1.4.0",
    "gulp-mocha": "~0.4.1",
    "jshint-stylish": "~0.1.5",
    "semver": "*"
  },
  "directories": {},
  "dist": {
    "shasum": "f024016f5a88e046fd12005055e939802e6c5f23",
    "tarball": "https://registry.npmjs.org/escodegen/-/escodegen-1.3.3.tgz"
  },
  "engines": {
    "node": ">=0.10.0"
  },
  "homepage": "http://github.com/Constellation/escodegen",
  "licenses": [
    {
      "type": "BSD",
      "url": "http://github.com/Constellation/escodegen/raw/master/LICENSE.BSD"
    }
  ],
  "main": "escodegen.js",
  "maintainers": [
    {
      "name": "constellation",
      "email": "utatane.tea@gmail.com"
    }
  ],
  "name": "escodegen",
  "optionalDependencies": {
    "source-map": "~0.1.33"
  },
  "readme": "ERROR: No README data found!",
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/Constellation/escodegen.git"
  },
  "scripts": {
    "build": "cjsify -a path: tools/entry-point.js > escodegen.browser.js",
    "build-min": "cjsify -ma path: tools/entry-point.js > escodegen.browser.min.js",
    "lint": "gulp lint",
    "release": "node tools/release.js",
    "test": "gulp travis",
    "unit-test": "gulp test"
  },
  "version": "1.3.3"
}

},{}],29:[function(require,module,exports){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
/*jslint vars:false, bitwise:true*/
/*jshint indent:4*/
/*global exports:true, define:true*/
(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // and plain browser loading,
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.estraverse = {}));
    }
}(this, function (exports) {
    'use strict';

    var Syntax,
        isArray,
        VisitorOption,
        VisitorKeys,
        BREAK,
        SKIP;

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ClassBody: 'ClassBody',
        ClassDeclaration: 'ClassDeclaration',
        ClassExpression: 'ClassExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        MethodDefinition: 'MethodDefinition',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    function ignoreJSHintError() { }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function deepCopy(obj) {
        var ret = {}, key, val;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                val = obj[key];
                if (typeof val === 'object' && val !== null) {
                    ret[key] = deepCopy(val);
                } else {
                    ret[key] = val;
                }
            }
        }
        return ret;
    }

    function shallowCopy(obj) {
        var ret = {}, key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                ret[key] = obj[key];
            }
        }
        return ret;
    }
    ignoreJSHintError(shallowCopy);

    // based on LLVM libc++ upper_bound / lower_bound
    // MIT License

    function upperBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                len = diff;
            } else {
                i = current + 1;
                len -= diff + 1;
            }
        }
        return i;
    }

    function lowerBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                i = current + 1;
                len -= diff + 1;
            } else {
                len = diff;
            }
        }
        return i;
    }
    ignoreJSHintError(lowerBound);

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        ArrayExpression: ['elements'],
        ArrayPattern: ['elements'],
        ArrowFunctionExpression: ['params', 'defaults', 'rest', 'body'],
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ClassBody: ['body'],
        ClassDeclaration: ['id', 'body', 'superClass'],
        ClassExpression: ['id', 'body', 'superClass'],
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DebuggerStatement: [],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        EmptyStatement: [],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        ForOfStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'defaults', 'rest', 'body'],
        FunctionExpression: ['id', 'params', 'defaults', 'rest', 'body'],
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        MethodDefinition: ['key', 'value'],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        ObjectPattern: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        ThisExpression: [],
        ThrowStatement: ['argument'],
        TryStatement: ['block', 'handlers', 'handler', 'guardedHandlers', 'finalizer'],
        UnaryExpression: ['argument'],
        UpdateExpression: ['argument'],
        VariableDeclaration: ['declarations'],
        VariableDeclarator: ['id', 'init'],
        WhileStatement: ['test', 'body'],
        WithStatement: ['object', 'body'],
        YieldExpression: ['argument']
    };

    // unique id
    BREAK = {};
    SKIP = {};

    VisitorOption = {
        Break: BREAK,
        Skip: SKIP
    };

    function Reference(parent, key) {
        this.parent = parent;
        this.key = key;
    }

    Reference.prototype.replace = function replace(node) {
        this.parent[this.key] = node;
    };

    function Element(node, path, wrap, ref) {
        this.node = node;
        this.path = path;
        this.wrap = wrap;
        this.ref = ref;
    }

    function Controller() { }

    // API:
    // return property path array from root to current node
    Controller.prototype.path = function path() {
        var i, iz, j, jz, result, element;

        function addToPath(result, path) {
            if (isArray(path)) {
                for (j = 0, jz = path.length; j < jz; ++j) {
                    result.push(path[j]);
                }
            } else {
                result.push(path);
            }
        }

        // root node
        if (!this.__current.path) {
            return null;
        }

        // first node is sentinel, second node is root element
        result = [];
        for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
            element = this.__leavelist[i];
            addToPath(result, element.path);
        }
        addToPath(result, this.__current.path);
        return result;
    };

    // API:
    // return array of parent elements
    Controller.prototype.parents = function parents() {
        var i, iz, result;

        // first node is sentinel
        result = [];
        for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
            result.push(this.__leavelist[i].node);
        }

        return result;
    };

    // API:
    // return current node
    Controller.prototype.current = function current() {
        return this.__current.node;
    };

    Controller.prototype.__execute = function __execute(callback, element) {
        var previous, result;

        result = undefined;

        previous  = this.__current;
        this.__current = element;
        this.__state = null;
        if (callback) {
            result = callback.call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
        }
        this.__current = previous;

        return result;
    };

    // API:
    // notify control skip / break
    Controller.prototype.notify = function notify(flag) {
        this.__state = flag;
    };

    // API:
    // skip child nodes of current node
    Controller.prototype.skip = function () {
        this.notify(SKIP);
    };

    // API:
    // break traversals
    Controller.prototype['break'] = function () {
        this.notify(BREAK);
    };

    Controller.prototype.__initialize = function(root, visitor) {
        this.visitor = visitor;
        this.root = root;
        this.__worklist = [];
        this.__leavelist = [];
        this.__current = null;
        this.__state = null;
    };

    Controller.prototype.traverse = function traverse(root, visitor) {
        var worklist,
            leavelist,
            element,
            node,
            nodeType,
            ret,
            key,
            current,
            current2,
            candidates,
            candidate,
            sentinel;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        worklist.push(new Element(root, null, null, null));
        leavelist.push(new Element(null, null, null, null));

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                ret = this.__execute(visitor.leave, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }
                continue;
            }

            if (element.node) {

                ret = this.__execute(visitor.enter, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }

                worklist.push(sentinel);
                leavelist.push(element);

                if (this.__state === SKIP || ret === SKIP) {
                    continue;
                }

                node = element.node;
                nodeType = element.wrap || node.type;
                candidates = VisitorKeys[nodeType];

                current = candidates.length;
                while ((current -= 1) >= 0) {
                    key = candidates[current];
                    candidate = node[key];
                    if (!candidate) {
                        continue;
                    }

                    if (!isArray(candidate)) {
                        worklist.push(new Element(candidate, key, null, null));
                        continue;
                    }

                    current2 = candidate.length;
                    while ((current2 -= 1) >= 0) {
                        if (!candidate[current2]) {
                            continue;
                        }
                        if ((nodeType === Syntax.ObjectExpression || nodeType === Syntax.ObjectPattern) && 'properties' === candidates[current]) {
                            element = new Element(candidate[current2], [key, current2], 'Property', null);
                        } else {
                            element = new Element(candidate[current2], [key, current2], null, null);
                        }
                        worklist.push(element);
                    }
                }
            }
        }
    };

    Controller.prototype.replace = function replace(root, visitor) {
        var worklist,
            leavelist,
            node,
            nodeType,
            target,
            element,
            current,
            current2,
            candidates,
            candidate,
            sentinel,
            outer,
            key;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        outer = {
            root: root
        };
        element = new Element(root, null, null, new Reference(outer, 'root'));
        worklist.push(element);
        leavelist.push(element);

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                target = this.__execute(visitor.leave, element);

                // node may be replaced with null,
                // so distinguish between undefined and null in this place
                if (target !== undefined && target !== BREAK && target !== SKIP) {
                    // replace
                    element.ref.replace(target);
                }

                if (this.__state === BREAK || target === BREAK) {
                    return outer.root;
                }
                continue;
            }

            target = this.__execute(visitor.enter, element);

            // node may be replaced with null,
            // so distinguish between undefined and null in this place
            if (target !== undefined && target !== BREAK && target !== SKIP) {
                // replace
                element.ref.replace(target);
                element.node = target;
            }

            if (this.__state === BREAK || target === BREAK) {
                return outer.root;
            }

            // node may be null
            node = element.node;
            if (!node) {
                continue;
            }

            worklist.push(sentinel);
            leavelist.push(element);

            if (this.__state === SKIP || target === SKIP) {
                continue;
            }

            nodeType = element.wrap || node.type;
            candidates = VisitorKeys[nodeType];

            current = candidates.length;
            while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = node[key];
                if (!candidate) {
                    continue;
                }

                if (!isArray(candidate)) {
                    worklist.push(new Element(candidate, key, null, new Reference(node, key)));
                    continue;
                }

                current2 = candidate.length;
                while ((current2 -= 1) >= 0) {
                    if (!candidate[current2]) {
                        continue;
                    }
                    if (nodeType === Syntax.ObjectExpression && 'properties' === candidates[current]) {
                        element = new Element(candidate[current2], [key, current2], 'Property', new Reference(candidate, current2));
                    } else {
                        element = new Element(candidate[current2], [key, current2], null, new Reference(candidate, current2));
                    }
                    worklist.push(element);
                }
            }
        }

        return outer.root;
    };

    function traverse(root, visitor) {
        var controller = new Controller();
        return controller.traverse(root, visitor);
    }

    function replace(root, visitor) {
        var controller = new Controller();
        return controller.replace(root, visitor);
    }

    function extendCommentRange(comment, tokens) {
        var target;

        target = upperBound(tokens, function search(token) {
            return token.range[0] > comment.range[0];
        });

        comment.extendedRange = [comment.range[0], comment.range[1]];

        if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
        }

        target -= 1;
        if (target >= 0) {
            comment.extendedRange[0] = tokens[target].range[1];
        }

        return comment;
    }

    function attachComments(tree, providedComments, tokens) {
        // At first, we should calculate extended comment ranges.
        var comments = [], comment, len, i, cursor;

        if (!tree.range) {
            throw new Error('attachComments needs range information');
        }

        // tokens array is empty, we attach comments to tree as 'leadingComments'
        if (!tokens.length) {
            if (providedComments.length) {
                for (i = 0, len = providedComments.length; i < len; i += 1) {
                    comment = deepCopy(providedComments[i]);
                    comment.extendedRange = [0, tree.range[0]];
                    comments.push(comment);
                }
                tree.leadingComments = comments;
            }
            return tree;
        }

        for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
        }

        // This is based on John Freeman's implementation.
        cursor = 0;
        traverse(tree, {
            enter: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (comment.extendedRange[1] > node.range[0]) {
                        break;
                    }

                    if (comment.extendedRange[1] === node.range[0]) {
                        if (!node.leadingComments) {
                            node.leadingComments = [];
                        }
                        node.leadingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        cursor = 0;
        traverse(tree, {
            leave: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (node.range[1] < comment.extendedRange[0]) {
                        break;
                    }

                    if (node.range[1] === comment.extendedRange[0]) {
                        if (!node.trailingComments) {
                            node.trailingComments = [];
                        }
                        node.trailingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        return tree;
    }

    exports.version = '1.5.1-dev';
    exports.Syntax = Syntax;
    exports.traverse = traverse;
    exports.replace = replace;
    exports.attachComments = attachComments;
    exports.VisitorKeys = VisitorKeys;
    exports.VisitorOption = VisitorOption;
    exports.Controller = Controller;
}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],30:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var Regex;

    // See also tools/generate-unicode-regex.py.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]'),
        NonAsciiIdentifierPart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]')
    };

    function isDecimalDigit(ch) {
        return (ch >= 48 && ch <= 57);   // 0..9
    }

    function isHexDigit(ch) {
        return isDecimalDigit(ch) || (97 <= ch && ch <= 102) || (65 <= ch && ch <= 70);
    }

    function isOctalDigit(ch) {
        return (ch >= 48 && ch <= 55);   // 0..7
    }

    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === 0x20) || (ch === 0x09) || (ch === 0x0B) || (ch === 0x0C) || (ch === 0xA0) ||
            (ch >= 0x1680 && [0x1680, 0x180E, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000, 0xFEFF].indexOf(ch) >= 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === 0x0A) || (ch === 0x0D) || (ch === 0x2028) || (ch === 0x2029);
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch)));
    }

    function isIdentifierPart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch >= 48 && ch <= 57) ||         // 0..9
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch)));
    }

    module.exports = {
        isDecimalDigit: isDecimalDigit,
        isHexDigit: isHexDigit,
        isOctalDigit: isOctalDigit,
        isWhiteSpace: isWhiteSpace,
        isLineTerminator: isLineTerminator,
        isIdentifierStart: isIdentifierStart,
        isIdentifierPart: isIdentifierPart
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],31:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var code = require('./code');

    function isStrictModeReservedWordES6(id) {
        switch (id) {
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'let':
            return true;
        default:
            return false;
        }
    }

    function isKeywordES5(id, strict) {
        // yield should not be treated as keyword under non-strict mode.
        if (!strict && id === 'yield') {
            return false;
        }
        return isKeywordES6(id, strict);
    }

    function isKeywordES6(id, strict) {
        if (strict && isStrictModeReservedWordES6(id)) {
            return true;
        }

        switch (id.length) {
        case 2:
            return (id === 'if') || (id === 'in') || (id === 'do');
        case 3:
            return (id === 'var') || (id === 'for') || (id === 'new') || (id === 'try');
        case 4:
            return (id === 'this') || (id === 'else') || (id === 'case') ||
                (id === 'void') || (id === 'with') || (id === 'enum');
        case 5:
            return (id === 'while') || (id === 'break') || (id === 'catch') ||
                (id === 'throw') || (id === 'const') || (id === 'yield') ||
                (id === 'class') || (id === 'super');
        case 6:
            return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                (id === 'switch') || (id === 'export') || (id === 'import');
        case 7:
            return (id === 'default') || (id === 'finally') || (id === 'extends');
        case 8:
            return (id === 'function') || (id === 'continue') || (id === 'debugger');
        case 10:
            return (id === 'instanceof');
        default:
            return false;
        }
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    function isIdentifierName(id) {
        var i, iz, ch;

        if (id.length === 0) {
            return false;
        }

        ch = id.charCodeAt(0);
        if (!code.isIdentifierStart(ch) || ch === 92) {  // \ (backslash)
            return false;
        }

        for (i = 1, iz = id.length; i < iz; ++i) {
            ch = id.charCodeAt(i);
            if (!code.isIdentifierPart(ch) || ch === 92) {  // \ (backslash)
                return false;
            }
        }
        return true;
    }

    module.exports = {
        isKeywordES5: isKeywordES5,
        isKeywordES6: isKeywordES6,
        isRestrictedWord: isRestrictedWord,
        isIdentifierName: isIdentifierName
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":30}],32:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


(function () {
    'use strict';

    exports.code = require('./code');
    exports.keyword = require('./keyword');
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":30,"./keyword":31}],33:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],34:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],35:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],36:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require("g5I+bs"))
},{"g5I+bs":37}],37:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],38:[function(require,module,exports){
/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = require('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = require('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = require('./source-map/source-node').SourceNode;

},{"./source-map/source-map-consumer":44,"./source-map/source-map-generator":45,"./source-map/source-node":46}],39:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');

  /**
   * A data structure which is a combination of an array and a set. Adding a new
   * member is O(1), testing for membership is O(1), and finding the index of an
   * element is O(1). Removing elements from the set is not supported. Only
   * strings are supported for membership.
   */
  function ArraySet() {
    this._array = [];
    this._set = {};
  }

  /**
   * Static method for creating ArraySet instances from an existing array.
   */
  ArraySet.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
    var set = new ArraySet();
    for (var i = 0, len = aArray.length; i < len; i++) {
      set.add(aArray[i], aAllowDuplicates);
    }
    return set;
  };

  /**
   * Add the given string to this set.
   *
   * @param String aStr
   */
  ArraySet.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
    var isDuplicate = this.has(aStr);
    var idx = this._array.length;
    if (!isDuplicate || aAllowDuplicates) {
      this._array.push(aStr);
    }
    if (!isDuplicate) {
      this._set[util.toSetString(aStr)] = idx;
    }
  };

  /**
   * Is the given string a member of this set?
   *
   * @param String aStr
   */
  ArraySet.prototype.has = function ArraySet_has(aStr) {
    return Object.prototype.hasOwnProperty.call(this._set,
                                                util.toSetString(aStr));
  };

  /**
   * What is the index of the given string in the array?
   *
   * @param String aStr
   */
  ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
    if (this.has(aStr)) {
      return this._set[util.toSetString(aStr)];
    }
    throw new Error('"' + aStr + '" is not in the set.');
  };

  /**
   * What is the element at the given index?
   *
   * @param Number aIdx
   */
  ArraySet.prototype.at = function ArraySet_at(aIdx) {
    if (aIdx >= 0 && aIdx < this._array.length) {
      return this._array[aIdx];
    }
    throw new Error('No element indexed by ' + aIdx);
  };

  /**
   * Returns the array representation of this set (which has the proper indices
   * indicated by indexOf). Note that this is a copy of the internal array used
   * for storing the members so that no one can mess with internal state.
   */
  ArraySet.prototype.toArray = function ArraySet_toArray() {
    return this._array.slice();
  };

  exports.ArraySet = ArraySet;

});

},{"./util":47,"amdefine":3}],40:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64 = require('./base64');

  // A single base 64 digit can contain 6 bits of data. For the base 64 variable
  // length quantities we use in the source map spec, the first bit is the sign,
  // the next four bits are the actual value, and the 6th bit is the
  // continuation bit. The continuation bit tells us whether there are more
  // digits in this value following this digit.
  //
  //   Continuation
  //   |    Sign
  //   |    |
  //   V    V
  //   101011

  var VLQ_BASE_SHIFT = 5;

  // binary: 100000
  var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

  // binary: 011111
  var VLQ_BASE_MASK = VLQ_BASE - 1;

  // binary: 100000
  var VLQ_CONTINUATION_BIT = VLQ_BASE;

  /**
   * Converts from a two-complement value to a value where the sign bit is
   * placed in the least significant bit.  For example, as decimals:
   *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
   *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
   */
  function toVLQSigned(aValue) {
    return aValue < 0
      ? ((-aValue) << 1) + 1
      : (aValue << 1) + 0;
  }

  /**
   * Converts to a two-complement value from a value where the sign bit is
   * placed in the least significant bit.  For example, as decimals:
   *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
   *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
   */
  function fromVLQSigned(aValue) {
    var isNegative = (aValue & 1) === 1;
    var shifted = aValue >> 1;
    return isNegative
      ? -shifted
      : shifted;
  }

  /**
   * Returns the base 64 VLQ encoded value.
   */
  exports.encode = function base64VLQ_encode(aValue) {
    var encoded = "";
    var digit;

    var vlq = toVLQSigned(aValue);

    do {
      digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        // There are still more digits in this value, so we must make sure the
        // continuation bit is marked.
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += base64.encode(digit);
    } while (vlq > 0);

    return encoded;
  };

  /**
   * Decodes the next base 64 VLQ value from the given string and returns the
   * value and the rest of the string via the out parameter.
   */
  exports.decode = function base64VLQ_decode(aStr, aOutParam) {
    var i = 0;
    var strLen = aStr.length;
    var result = 0;
    var shift = 0;
    var continuation, digit;

    do {
      if (i >= strLen) {
        throw new Error("Expected more digits in base 64 VLQ value.");
      }
      digit = base64.decode(aStr.charAt(i++));
      continuation = !!(digit & VLQ_CONTINUATION_BIT);
      digit &= VLQ_BASE_MASK;
      result = result + (digit << shift);
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    aOutParam.value = fromVLQSigned(result);
    aOutParam.rest = aStr.slice(i);
  };

});

},{"./base64":41,"amdefine":3}],41:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var charToIntMap = {};
  var intToCharMap = {};

  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .forEach(function (ch, index) {
      charToIntMap[ch] = index;
      intToCharMap[index] = ch;
    });

  /**
   * Encode an integer in the range of 0 to 63 to a single base 64 digit.
   */
  exports.encode = function base64_encode(aNumber) {
    if (aNumber in intToCharMap) {
      return intToCharMap[aNumber];
    }
    throw new TypeError("Must be between 0 and 63: " + aNumber);
  };

  /**
   * Decode a single base 64 digit to an integer.
   */
  exports.decode = function base64_decode(aChar) {
    if (aChar in charToIntMap) {
      return charToIntMap[aChar];
    }
    throw new TypeError("Not a valid base 64 digit: " + aChar);
  };

});

},{"amdefine":3}],42:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the index of
    //      the next closest element that is less than that element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element which is less than the one we are searching for, so we
    //      return -1.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid], true);
    if (cmp === 0) {
      // Found the element we are looking for.
      return mid;
    }
    else if (cmp > 0) {
      // aHaystack[mid] is greater than our needle.
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare);
      }
      // We did not find an exact match, return the next closest one
      // (termination case 2).
      return mid;
    }
    else {
      // aHaystack[mid] is less than our needle.
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare);
      }
      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (2) or (3) and return the appropriate thing.
      return aLow < 0 ? -1 : aLow;
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the index of next lowest value checked if there is no exact hit. This is
   * because mappings between original and generated line/col pairs are single
   * points, and there is an implicit region between each of them, so a miss
   * just means that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare) {
    if (aHaystack.length === 0) {
      return -1;
    }
    return recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack, aCompare)
  };

});

},{"amdefine":3}],43:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2014 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');

  /**
   * Determine whether mappingB is after mappingA with respect to generated
   * position.
   */
  function generatedPositionAfter(mappingA, mappingB) {
    // Optimized for most common case
    var lineA = mappingA.generatedLine;
    var lineB = mappingB.generatedLine;
    var columnA = mappingA.generatedColumn;
    var columnB = mappingB.generatedColumn;
    return lineB > lineA || lineB == lineA && columnB >= columnA ||
           util.compareByGeneratedPositions(mappingA, mappingB) <= 0;
  }

  /**
   * A data structure to provide a sorted view of accumulated mappings in a
   * performance conscious manner. It trades a neglibable overhead in general
   * case for a large speedup in case of mappings being added in order.
   */
  function MappingList() {
    this._array = [];
    this._sorted = true;
    // Serves as infimum
    this._last = {generatedLine: -1, generatedColumn: 0};
  }

  /**
   * Iterate through internal items. This method takes the same arguments that
   * `Array.prototype.forEach` takes.
   *
   * NOTE: The order of the mappings is NOT guaranteed.
   */
  MappingList.prototype.unsortedForEach =
    function MappingList_forEach(aCallback, aThisArg) {
      this._array.forEach(aCallback, aThisArg);
    };

  /**
   * Add the given source mapping.
   *
   * @param Object aMapping
   */
  MappingList.prototype.add = function MappingList_add(aMapping) {
    var mapping;
    if (generatedPositionAfter(this._last, aMapping)) {
      this._last = aMapping;
      this._array.push(aMapping);
    } else {
      this._sorted = false;
      this._array.push(aMapping);
    }
  };

  /**
   * Returns the flat, sorted array of mappings. The mappings are sorted by
   * generated position.
   *
   * WARNING: This method returns internal data without copying, for
   * performance. The return value must NOT be mutated, and should be treated as
   * an immutable borrow. If you want to take ownership, you must make your own
   * copy.
   */
  MappingList.prototype.toArray = function MappingList_toArray() {
    if (!this._sorted) {
      this._array.sort(util.compareByGeneratedPositions);
      this._sorted = true;
    }
    return this._array;
  };

  exports.MappingList = MappingList;

});

},{"./util":47,"amdefine":3}],44:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');
  var binarySearch = require('./binary-search');
  var ArraySet = require('./array-set').ArraySet;
  var base64VLQ = require('./base64-vlq');

  /**
   * A SourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The only parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: Optional. The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
    // requires the array) to play nice here.
    var names = util.getArg(sourceMap, 'names', []);
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file', null);

    // Once again, Sass deviates from the spec and supplies the version as a
    // string rather than a number, so we use loose equality checking here.
    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    // Some source maps produce relative source paths like "./foo.js" instead of
    // "foo.js".  Normalize these first so that future comparisons will succeed.
    // See bugzil.la/1090768.
    sources = sources.map(util.normalize);

    // Pass `true` below to allow duplicate names and sources. While source maps
    // are intended to be compressed and deduplicated, the TypeScript compiler
    // sometimes generates source maps with duplicates in them. See Github issue
    // #72 and bugzil.la/889492.
    this._names = ArraySet.fromArray(names, true);
    this._sources = ArraySet.fromArray(sources, true);

    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this._mappings = mappings;
    this.file = file;
  }

  /**
   * Create a SourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @returns SourceMapConsumer
   */
  SourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap) {
      var smc = Object.create(SourceMapConsumer.prototype);

      smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
      smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
      smc.sourceRoot = aSourceMap._sourceRoot;
      smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                              smc.sourceRoot);
      smc.file = aSourceMap._file;

      smc.__generatedMappings = aSourceMap._mappings.toArray().slice();
      smc.__originalMappings = aSourceMap._mappings.toArray().slice()
        .sort(util.compareByOriginalPositions);

      return smc;
    };

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(SourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot != null ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  // `__generatedMappings` and `__originalMappings` are arrays that hold the
  // parsed mapping coordinates from the source map's "mappings" attribute. They
  // are lazily instantiated, accessed via the `_generatedMappings` and
  // `_originalMappings` getters respectively, and we only parse the mappings
  // and create these arrays once queried for a source location. We jump through
  // these hoops because there can be many thousands of mappings, and parsing
  // them is expensive, so we only want to do it if we must.
  //
  // Each object in the arrays is of the form:
  //
  //     {
  //       generatedLine: The line number in the generated code,
  //       generatedColumn: The column number in the generated code,
  //       source: The path to the original source file that generated this
  //               chunk of code,
  //       originalLine: The line number in the original source that
  //                     corresponds to this chunk of generated code,
  //       originalColumn: The column number in the original source that
  //                       corresponds to this chunk of generated code,
  //       name: The name of the original symbol which generated this chunk of
  //             code.
  //     }
  //
  // All properties except for `generatedLine` and `generatedColumn` can be
  // `null`.
  //
  // `_generatedMappings` is ordered by the generated positions.
  //
  // `_originalMappings` is ordered by the original positions.

  SourceMapConsumer.prototype.__generatedMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
    get: function () {
      if (!this.__generatedMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__generatedMappings;
    }
  });

  SourceMapConsumer.prototype.__originalMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
    get: function () {
      if (!this.__originalMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__originalMappings;
    }
  });

  SourceMapConsumer.prototype._nextCharIsMappingSeparator =
    function SourceMapConsumer_nextCharIsMappingSeparator(aStr) {
      var c = aStr.charAt(0);
      return c === ";" || c === ",";
    };

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var str = aStr;
      var temp = {};
      var mapping;

      while (str.length > 0) {
        if (str.charAt(0) === ';') {
          generatedLine++;
          str = str.slice(1);
          previousGeneratedColumn = 0;
        }
        else if (str.charAt(0) === ',') {
          str = str.slice(1);
        }
        else {
          mapping = {};
          mapping.generatedLine = generatedLine;

          // Generated column.
          base64VLQ.decode(str, temp);
          mapping.generatedColumn = previousGeneratedColumn + temp.value;
          previousGeneratedColumn = mapping.generatedColumn;
          str = temp.rest;

          if (str.length > 0 && !this._nextCharIsMappingSeparator(str)) {
            // Original source.
            base64VLQ.decode(str, temp);
            mapping.source = this._sources.at(previousSource + temp.value);
            previousSource += temp.value;
            str = temp.rest;
            if (str.length === 0 || this._nextCharIsMappingSeparator(str)) {
              throw new Error('Found a source, but no line and column');
            }

            // Original line.
            base64VLQ.decode(str, temp);
            mapping.originalLine = previousOriginalLine + temp.value;
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;
            str = temp.rest;
            if (str.length === 0 || this._nextCharIsMappingSeparator(str)) {
              throw new Error('Found a source and line, but no column');
            }

            // Original column.
            base64VLQ.decode(str, temp);
            mapping.originalColumn = previousOriginalColumn + temp.value;
            previousOriginalColumn = mapping.originalColumn;
            str = temp.rest;

            if (str.length > 0 && !this._nextCharIsMappingSeparator(str)) {
              // Original name.
              base64VLQ.decode(str, temp);
              mapping.name = this._names.at(previousName + temp.value);
              previousName += temp.value;
              str = temp.rest;
            }
          }

          this.__generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            this.__originalMappings.push(mapping);
          }
        }
      }

      this.__generatedMappings.sort(util.compareByGeneratedPositions);
      this.__originalMappings.sort(util.compareByOriginalPositions);
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  SourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator);
    };

  /**
   * Compute the last column for each generated mapping. The last column is
   * inclusive.
   */
  SourceMapConsumer.prototype.computeColumnSpans =
    function SourceMapConsumer_computeColumnSpans() {
      for (var index = 0; index < this._generatedMappings.length; ++index) {
        var mapping = this._generatedMappings[index];

        // Mappings do not contain a field for the last generated columnt. We
        // can come up with an optimistic estimate, however, by assuming that
        // mappings are contiguous (i.e. given two consecutive mappings, the
        // first mapping ends where the second one starts).
        if (index + 1 < this._generatedMappings.length) {
          var nextMapping = this._generatedMappings[index + 1];

          if (mapping.generatedLine === nextMapping.generatedLine) {
            mapping.lastGeneratedColumn = nextMapping.generatedColumn - 1;
            continue;
          }
        }

        // The last mapping for each line spans the entire line.
        mapping.lastGeneratedColumn = Infinity;
      }
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  SourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var index = this._findMapping(needle,
                                    this._generatedMappings,
                                    "generatedLine",
                                    "generatedColumn",
                                    util.compareByGeneratedPositions);

      if (index >= 0) {
        var mapping = this._generatedMappings[index];

        if (mapping.generatedLine === needle.generatedLine) {
          var source = util.getArg(mapping, 'source', null);
          if (source != null && this.sourceRoot != null) {
            source = util.join(this.sourceRoot, source);
          }
          return {
            source: source,
            line: util.getArg(mapping, 'originalLine', null),
            column: util.getArg(mapping, 'originalColumn', null),
            name: util.getArg(mapping, 'name', null)
          };
        }
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * availible.
   */
  SourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource) {
      if (!this.sourcesContent) {
        return null;
      }

      if (this.sourceRoot != null) {
        aSource = util.relative(this.sourceRoot, aSource);
      }

      if (this._sources.has(aSource)) {
        return this.sourcesContent[this._sources.indexOf(aSource)];
      }

      var url;
      if (this.sourceRoot != null
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + aSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + aSource)];
        }
      }

      throw new Error('"' + aSource + '" is not in the SourceMap.');
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      if (this.sourceRoot != null) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var index = this._findMapping(needle,
                                    this._originalMappings,
                                    "originalLine",
                                    "originalColumn",
                                    util.compareByOriginalPositions);

      if (index >= 0) {
        var mapping = this._originalMappings[index];

        return {
          line: util.getArg(mapping, 'generatedLine', null),
          column: util.getArg(mapping, 'generatedColumn', null),
          lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
        };
      }

      return {
        line: null,
        column: null,
        lastColumn: null
      };
    };

  /**
   * Returns all generated line and column information for the original source
   * and line provided. The only argument is an object with the following
   * properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *
   * and an array of objects is returned, each with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.allGeneratedPositionsFor =
    function SourceMapConsumer_allGeneratedPositionsFor(aArgs) {
      // When there is no exact match, SourceMapConsumer.prototype._findMapping
      // returns the index of the closest mapping less than the needle. By
      // setting needle.originalColumn to Infinity, we thus find the last
      // mapping for the given line, provided such a mapping exists.
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: Infinity
      };

      if (this.sourceRoot != null) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var mappings = [];

      var index = this._findMapping(needle,
                                    this._originalMappings,
                                    "originalLine",
                                    "originalColumn",
                                    util.compareByOriginalPositions);
      if (index >= 0) {
        var mapping = this._originalMappings[index];

        while (mapping && mapping.originalLine === needle.originalLine) {
          mappings.push({
            line: util.getArg(mapping, 'generatedLine', null),
            column: util.getArg(mapping, 'generatedColumn', null),
            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
          });

          mapping = this._originalMappings[--index];
        }
      }

      return mappings.reverse();
    };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source;
        if (source != null && sourceRoot != null) {
          source = util.join(sourceRoot, source);
        }
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name
        };
      }).forEach(aCallback, context);
    };

  exports.SourceMapConsumer = SourceMapConsumer;

});

},{"./array-set":39,"./base64-vlq":40,"./binary-search":42,"./util":47,"amdefine":3}],45:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64VLQ = require('./base64-vlq');
  var util = require('./util');
  var ArraySet = require('./array-set').ArraySet;
  var MappingList = require('./mapping-list').MappingList;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. You may pass an object with the following
   * properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: A root for all relative URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    if (!aArgs) {
      aArgs = {};
    }
    this._file = util.getArg(aArgs, 'file', null);
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._skipValidation = util.getArg(aArgs, 'skipValidation', false);
    this._sources = new ArraySet();
    this._names = new ArraySet();
    this._mappings = new MappingList();
    this._sourcesContents = null;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source != null) {
          newMapping.source = mapping.source;
          if (sourceRoot != null) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name != null) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      if (!this._skipValidation) {
        this._validateMapping(generated, original, source, name);
      }

      if (source != null && !this._sources.has(source)) {
        this._sources.add(source);
      }

      if (name != null && !this._names.has(name)) {
        this._names.add(name);
      }

      this._mappings.add({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        originalLine: original != null && original.line,
        originalColumn: original != null && original.column,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot != null) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent != null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = {};
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else if (this._sourcesContents) {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   * @param aSourceMapPath Optional. The dirname of the path to the source map
   *        to be applied. If relative, it is relative to the SourceMapConsumer.
   *        This parameter is needed when the two source maps aren't in the same
   *        directory, and the source map to be applied contains relative source
   *        paths. If so, those relative source paths need to be rewritten
   *        relative to the SourceMapGenerator.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
      var sourceFile = aSourceFile;
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (aSourceFile == null) {
        if (aSourceMapConsumer.file == null) {
          throw new Error(
            'SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, ' +
            'or the source map\'s "file" property. Both were omitted.'
          );
        }
        sourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "sourceFile" relative if an absolute Url is passed.
      if (sourceRoot != null) {
        sourceFile = util.relative(sourceRoot, sourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "sourceFile"
      this._mappings.unsortedForEach(function (mapping) {
        if (mapping.source === sourceFile && mapping.originalLine != null) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
          });
          if (original.source != null) {
            // Copy mapping
            mapping.source = original.source;
            if (aSourceMapPath != null) {
              mapping.source = util.join(aSourceMapPath, mapping.source)
            }
            if (sourceRoot != null) {
              mapping.source = util.relative(sourceRoot, mapping.source);
            }
            mapping.originalLine = original.line;
            mapping.originalColumn = original.column;
            if (original.name != null) {
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source != null && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name != null && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this._names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aSourceMapPath != null) {
            sourceFile = util.join(aSourceMapPath, sourceFile);
          }
          if (sourceRoot != null) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping: ' + JSON.stringify({
          generated: aGenerated,
          source: aSource,
          original: aOriginal,
          name: aName
        }));
      }
    };

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var mapping;

      var mappings = this._mappings.toArray();

      for (var i = 0, len = mappings.length; i < len; i++) {
        mapping = mappings[i];

        if (mapping.generatedLine !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generatedLine !== previousGeneratedLine) {
            result += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!util.compareByGeneratedPositions(mapping, mappings[i - 1])) {
              continue;
            }
            result += ',';
          }
        }

        result += base64VLQ.encode(mapping.generatedColumn
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generatedColumn;

        if (mapping.source != null) {
          result += base64VLQ.encode(this._sources.indexOf(mapping.source)
                                     - previousSource);
          previousSource = this._sources.indexOf(mapping.source);

          // lines are stored 0-based in SourceMap spec version 3
          result += base64VLQ.encode(mapping.originalLine - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          result += base64VLQ.encode(mapping.originalColumn
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.name != null) {
            result += base64VLQ.encode(this._names.indexOf(mapping.name)
                                       - previousName);
            previousName = this._names.indexOf(mapping.name);
          }
        }
      }

      return result;
    };

  SourceMapGenerator.prototype._generateSourcesContent =
    function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
      return aSources.map(function (source) {
        if (!this._sourcesContents) {
          return null;
        }
        if (aSourceRoot != null) {
          source = util.relative(aSourceRoot, source);
        }
        var key = util.toSetString(source);
        return Object.prototype.hasOwnProperty.call(this._sourcesContents,
                                                    key)
          ? this._sourcesContents[key]
          : null;
      }, this);
    };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        sources: this._sources.toArray(),
        names: this._names.toArray(),
        mappings: this._serializeMappings()
      };
      if (this._file != null) {
        map.file = this._file;
      }
      if (this._sourceRoot != null) {
        map.sourceRoot = this._sourceRoot;
      }
      if (this._sourcesContents) {
        map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
      }

      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this);
    };

  exports.SourceMapGenerator = SourceMapGenerator;

});

},{"./array-set":39,"./base64-vlq":40,"./mapping-list":43,"./util":47,"amdefine":3}],46:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var SourceMapGenerator = require('./source-map-generator').SourceMapGenerator;
  var util = require('./util');

  // Matches a Windows-style `\r\n` newline or a `\n` newline used by all other
  // operating systems these days (capturing the result).
  var REGEX_NEWLINE = /(\r?\n)/;

  // Newline character code for charCodeAt() comparisons
  var NEWLINE_CODE = 10;

  // Private symbol for identifying `SourceNode`s when multiple versions of
  // the source-map library are loaded. This MUST NOT CHANGE across
  // versions!
  var isSourceNode = "$$$isSourceNode$$$";

  /**
   * SourceNodes provide a way to abstract over interpolating/concatenating
   * snippets of generated JavaScript source code while maintaining the line and
   * column information associated with the original source code.
   *
   * @param aLine The original line number.
   * @param aColumn The original column number.
   * @param aSource The original source's filename.
   * @param aChunks Optional. An array of strings which are snippets of
   *        generated JS, or other SourceNodes.
   * @param aName The original identifier.
   */
  function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
    this.children = [];
    this.sourceContents = {};
    this.line = aLine == null ? null : aLine;
    this.column = aColumn == null ? null : aColumn;
    this.source = aSource == null ? null : aSource;
    this.name = aName == null ? null : aName;
    this[isSourceNode] = true;
    if (aChunks != null) this.add(aChunks);
  }

  /**
   * Creates a SourceNode from generated code and a SourceMapConsumer.
   *
   * @param aGeneratedCode The generated code
   * @param aSourceMapConsumer The SourceMap for the generated code
   * @param aRelativePath Optional. The path that relative sources in the
   *        SourceMapConsumer should be relative to.
   */
  SourceNode.fromStringWithSourceMap =
    function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer, aRelativePath) {
      // The SourceNode we want to fill with the generated code
      // and the SourceMap
      var node = new SourceNode();

      // All even indices of this array are one line of the generated code,
      // while all odd indices are the newlines between two adjacent lines
      // (since `REGEX_NEWLINE` captures its match).
      // Processed fragments are removed from this array, by calling `shiftNextLine`.
      var remainingLines = aGeneratedCode.split(REGEX_NEWLINE);
      var shiftNextLine = function() {
        var lineContents = remainingLines.shift();
        // The last line of a file might not have a newline.
        var newLine = remainingLines.shift() || "";
        return lineContents + newLine;
      };

      // We need to remember the position of "remainingLines"
      var lastGeneratedLine = 1, lastGeneratedColumn = 0;

      // The generate SourceNodes we need a code range.
      // To extract it current and last mapping is used.
      // Here we store the last mapping.
      var lastMapping = null;

      aSourceMapConsumer.eachMapping(function (mapping) {
        if (lastMapping !== null) {
          // We add the code from "lastMapping" to "mapping":
          // First check if there is a new line in between.
          if (lastGeneratedLine < mapping.generatedLine) {
            var code = "";
            // Associate first line with "lastMapping"
            addMappingWithCode(lastMapping, shiftNextLine());
            lastGeneratedLine++;
            lastGeneratedColumn = 0;
            // The remaining code is added without mapping
          } else {
            // There is no new line in between.
            // Associate the code between "lastGeneratedColumn" and
            // "mapping.generatedColumn" with "lastMapping"
            var nextLine = remainingLines[0];
            var code = nextLine.substr(0, mapping.generatedColumn -
                                          lastGeneratedColumn);
            remainingLines[0] = nextLine.substr(mapping.generatedColumn -
                                                lastGeneratedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
            addMappingWithCode(lastMapping, code);
            // No more remaining code, continue
            lastMapping = mapping;
            return;
          }
        }
        // We add the generated code until the first mapping
        // to the SourceNode without any mapping.
        // Each line is added as separate string.
        while (lastGeneratedLine < mapping.generatedLine) {
          node.add(shiftNextLine());
          lastGeneratedLine++;
        }
        if (lastGeneratedColumn < mapping.generatedColumn) {
          var nextLine = remainingLines[0];
          node.add(nextLine.substr(0, mapping.generatedColumn));
          remainingLines[0] = nextLine.substr(mapping.generatedColumn);
          lastGeneratedColumn = mapping.generatedColumn;
        }
        lastMapping = mapping;
      }, this);
      // We have processed all mappings.
      if (remainingLines.length > 0) {
        if (lastMapping) {
          // Associate the remaining code in the current line with "lastMapping"
          addMappingWithCode(lastMapping, shiftNextLine());
        }
        // and add the remaining lines without any mapping
        node.add(remainingLines.join(""));
      }

      // Copy sourcesContent into SourceNode
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aRelativePath != null) {
            sourceFile = util.join(aRelativePath, sourceFile);
          }
          node.setSourceContent(sourceFile, content);
        }
      });

      return node;

      function addMappingWithCode(mapping, code) {
        if (mapping === null || mapping.source === undefined) {
          node.add(code);
        } else {
          var source = aRelativePath
            ? util.join(aRelativePath, mapping.source)
            : mapping.source;
          node.add(new SourceNode(mapping.originalLine,
                                  mapping.originalColumn,
                                  source,
                                  code,
                                  mapping.name));
        }
      }
    };

  /**
   * Add a chunk of generated JS to this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.add = function SourceNode_add(aChunk) {
    if (Array.isArray(aChunk)) {
      aChunk.forEach(function (chunk) {
        this.add(chunk);
      }, this);
    }
    else if (aChunk[isSourceNode] || typeof aChunk === "string") {
      if (aChunk) {
        this.children.push(aChunk);
      }
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Add a chunk of generated JS to the beginning of this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
    if (Array.isArray(aChunk)) {
      for (var i = aChunk.length-1; i >= 0; i--) {
        this.prepend(aChunk[i]);
      }
    }
    else if (aChunk[isSourceNode] || typeof aChunk === "string") {
      this.children.unshift(aChunk);
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Walk over the tree of JS snippets in this node and its children. The
   * walking function is called once for each snippet of JS and is passed that
   * snippet and the its original associated source's line/column location.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walk = function SourceNode_walk(aFn) {
    var chunk;
    for (var i = 0, len = this.children.length; i < len; i++) {
      chunk = this.children[i];
      if (chunk[isSourceNode]) {
        chunk.walk(aFn);
      }
      else {
        if (chunk !== '') {
          aFn(chunk, { source: this.source,
                       line: this.line,
                       column: this.column,
                       name: this.name });
        }
      }
    }
  };

  /**
   * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
   * each of `this.children`.
   *
   * @param aSep The separator.
   */
  SourceNode.prototype.join = function SourceNode_join(aSep) {
    var newChildren;
    var i;
    var len = this.children.length;
    if (len > 0) {
      newChildren = [];
      for (i = 0; i < len-1; i++) {
        newChildren.push(this.children[i]);
        newChildren.push(aSep);
      }
      newChildren.push(this.children[i]);
      this.children = newChildren;
    }
    return this;
  };

  /**
   * Call String.prototype.replace on the very right-most source snippet. Useful
   * for trimming whitespace from the end of a source node, etc.
   *
   * @param aPattern The pattern to replace.
   * @param aReplacement The thing to replace the pattern with.
   */
  SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
    var lastChild = this.children[this.children.length - 1];
    if (lastChild[isSourceNode]) {
      lastChild.replaceRight(aPattern, aReplacement);
    }
    else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
    }
    else {
      this.children.push(''.replace(aPattern, aReplacement));
    }
    return this;
  };

  /**
   * Set the source content for a source file. This will be added to the SourceMapGenerator
   * in the sourcesContent field.
   *
   * @param aSourceFile The filename of the source file
   * @param aSourceContent The content of the source file
   */
  SourceNode.prototype.setSourceContent =
    function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
      this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
    };

  /**
   * Walk over the tree of SourceNodes. The walking function is called for each
   * source file content and is passed the filename and source content.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walkSourceContents =
    function SourceNode_walkSourceContents(aFn) {
      for (var i = 0, len = this.children.length; i < len; i++) {
        if (this.children[i][isSourceNode]) {
          this.children[i].walkSourceContents(aFn);
        }
      }

      var sources = Object.keys(this.sourceContents);
      for (var i = 0, len = sources.length; i < len; i++) {
        aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
      }
    };

  /**
   * Return the string representation of this source node. Walks over the tree
   * and concatenates all the various snippets together to one string.
   */
  SourceNode.prototype.toString = function SourceNode_toString() {
    var str = "";
    this.walk(function (chunk) {
      str += chunk;
    });
    return str;
  };

  /**
   * Returns the string representation of this source node along with a source
   * map.
   */
  SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: "",
      line: 1,
      column: 0
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    var lastOriginalSource = null;
    var lastOriginalLine = null;
    var lastOriginalColumn = null;
    var lastOriginalName = null;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (original.source !== null
          && original.line !== null
          && original.column !== null) {
        if(lastOriginalSource !== original.source
           || lastOriginalLine !== original.line
           || lastOriginalColumn !== original.column
           || lastOriginalName !== original.name) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column
            },
            generated: {
              line: generated.line,
              column: generated.column
            },
            name: original.name
          });
        }
        lastOriginalSource = original.source;
        lastOriginalLine = original.line;
        lastOriginalColumn = original.column;
        lastOriginalName = original.name;
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column
          }
        });
        lastOriginalSource = null;
        sourceMappingActive = false;
      }
      for (var idx = 0, length = chunk.length; idx < length; idx++) {
        if (chunk.charCodeAt(idx) === NEWLINE_CODE) {
          generated.line++;
          generated.column = 0;
          // Mappings end at eol
          if (idx + 1 === length) {
            lastOriginalSource = null;
            sourceMappingActive = false;
          } else if (sourceMappingActive) {
            map.addMapping({
              source: original.source,
              original: {
                line: original.line,
                column: original.column
              },
              generated: {
                line: generated.line,
                column: generated.column
              },
              name: original.name
            });
          }
        } else {
          generated.column++;
        }
      }
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

  exports.SourceNode = SourceNode;

});

},{"./source-map-generator":45,"./util":47,"amdefine":3}],47:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.]*)(?::(\d+))?(\S*)$/;
  var dataUrlRegexp = /^data:.+\,.+$/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[2],
      host: match[3],
      port: match[4],
      path: match[5]
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = '';
    if (aParsedUrl.scheme) {
      url += aParsedUrl.scheme + ':';
    }
    url += '//';
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + '@';
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  /**
   * Normalizes a path, or the path portion of a URL:
   *
   * - Replaces consequtive slashes with one slash.
   * - Removes unnecessary '.' parts.
   * - Removes unnecessary '<dir>/..' parts.
   *
   * Based on code in the Node.js 'path' core module.
   *
   * @param aPath The path or url to normalize.
   */
  function normalize(aPath) {
    var path = aPath;
    var url = urlParse(aPath);
    if (url) {
      if (!url.path) {
        return aPath;
      }
      path = url.path;
    }
    var isAbsolute = (path.charAt(0) === '/');

    var parts = path.split(/\/+/);
    for (var part, up = 0, i = parts.length - 1; i >= 0; i--) {
      part = parts[i];
      if (part === '.') {
        parts.splice(i, 1);
      } else if (part === '..') {
        up++;
      } else if (up > 0) {
        if (part === '') {
          // The first part is blank if the path is absolute. Trying to go
          // above the root is a no-op. Therefore we can remove all '..' parts
          // directly after the root.
          parts.splice(i + 1, up);
          up = 0;
        } else {
          parts.splice(i, 2);
          up--;
        }
      }
    }
    path = parts.join('/');

    if (path === '') {
      path = isAbsolute ? '/' : '.';
    }

    if (url) {
      url.path = path;
      return urlGenerate(url);
    }
    return path;
  }
  exports.normalize = normalize;

  /**
   * Joins two paths/URLs.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be joined with the root.
   *
   * - If aPath is a URL or a data URI, aPath is returned, unless aPath is a
   *   scheme-relative URL: Then the scheme of aRoot, if any, is prepended
   *   first.
   * - Otherwise aPath is a path. If aRoot is a URL, then its path portion
   *   is updated with the result and aRoot is returned. Otherwise the result
   *   is returned.
   *   - If aPath is absolute, the result is aPath.
   *   - Otherwise the two paths are joined with a slash.
   * - Joining for example 'http://' and 'www.example.com' is also supported.
   */
  function join(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }
    if (aPath === "") {
      aPath = ".";
    }
    var aPathUrl = urlParse(aPath);
    var aRootUrl = urlParse(aRoot);
    if (aRootUrl) {
      aRoot = aRootUrl.path || '/';
    }

    // `join(foo, '//www.example.org')`
    if (aPathUrl && !aPathUrl.scheme) {
      if (aRootUrl) {
        aPathUrl.scheme = aRootUrl.scheme;
      }
      return urlGenerate(aPathUrl);
    }

    if (aPathUrl || aPath.match(dataUrlRegexp)) {
      return aPath;
    }

    // `join('http://', 'www.example.com')`
    if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
      aRootUrl.host = aPath;
      return urlGenerate(aRootUrl);
    }

    var joined = aPath.charAt(0) === '/'
      ? aPath
      : normalize(aRoot.replace(/\/+$/, '') + '/' + aPath);

    if (aRootUrl) {
      aRootUrl.path = joined;
      return urlGenerate(aRootUrl);
    }
    return joined;
  }
  exports.join = join;

  /**
   * Make a path relative to a URL or another path.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be made relative to aRoot.
   */
  function relative(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }

    aRoot = aRoot.replace(/\/$/, '');

    // XXX: It is possible to remove this block, and the tests still pass!
    var url = urlParse(aRoot);
    if (aPath.charAt(0) == "/" && url && url.path == "/") {
      return aPath.slice(1);
    }

    return aPath.indexOf(aRoot + '/') === 0
      ? aPath.substr(aRoot.length + 1)
      : aPath;
  }
  exports.relative = relative;

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    return '$' + aStr;
  }
  exports.toSetString = toSetString;

  function fromSetString(aStr) {
    return aStr.substr(1);
  }
  exports.fromSetString = fromSetString;

  function strcmp(aStr1, aStr2) {
    var s1 = aStr1 || "";
    var s2 = aStr2 || "";
    return (s1 > s2) - (s1 < s2);
  }

  /**
   * Comparator between two mappings where the original positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same original source/line/column, but different generated
   * line and column the same. Useful when searching for a mapping with a
   * stubbed out mapping.
   */
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp;

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp || onlyCompareOriginal) {
      return cmp;
    }

    cmp = strcmp(mappingA.name, mappingB.name);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    return mappingA.generatedColumn - mappingB.generatedColumn;
  };
  exports.compareByOriginalPositions = compareByOriginalPositions;

  /**
   * Comparator between two mappings where the generated positions are
   * compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same generated line and column, but different
   * source/name/original line and column the same. Useful when searching for a
   * mapping with a stubbed out mapping.
   */
  function compareByGeneratedPositions(mappingA, mappingB, onlyCompareGenerated) {
    var cmp;

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp || onlyCompareGenerated) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  };
  exports.compareByGeneratedPositions = compareByGeneratedPositions;

});

},{"amdefine":3}],48:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],49:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],50:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require("g5I+bs"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":49,"g5I+bs":37,"inherits":48}],51:[function(require,module,exports){

// var Type = Object.freeze({
// 	"String": {},
// 	"Number": {},
// 	"Identifier": {},
// });

// A chain is a left-associative application of zero or more messages
function Chain (messages) {
	// Preconditions
	assertArray(messages, assertMessage);

	this.type = 'chain'; // TODO remove eventually
	this.value = messages;
}
Chain.prototype.getMessages = function () {
	return this.value;
};
Chain.prototype.setMessages = function (messages) {
	this.value = messages;
};

// A message is a symbol plus arguments

function Message (symbol) {
	// Preconditions
	assertSymbol(symbol);
	// TODO arguments are either messages or chains?

	this.type = 'message'; // TODO remove eventually
	this.value = symbol;
}
Message.prototype.getSymbolValue = function () {
	return this.value.getLiteralValue();
};
Message.prototype.getSymbolType = function () {
	return this.value.getLiteralType();
};
Message.prototype.getArguments = function () {
	return this.value.getArguments();
};

// A symbol is anything that may serve as a literal value:
// a number, string, or idenfitier

function Symbol (literal, arguments) {
	// Preconditions
	assertLiteral(literal);
	assertArray(arguments);
	// TODO arguments are either messages or chains?

	this.type = 'symbol'; // TODO remove eventually
	this.value = literal;
	this.arguments = arguments;
}
Symbol.prototype.getLiteralType = function () {
	return this.value.getType();
}
Symbol.prototype.getLiteralValue = function () {
	return this.value.getValue();
}
Symbol.prototype.getArguments = function () {
	return this.arguments;
}

function Literal (type, value) {
	console.assert(type === 'string' || type === 'number' || type === 'identifier')
	this.type = type;
	this.value = value;
}
Literal.prototype.getType = function () {
	return this.type;
};
Literal.prototype.getValue = function () {
	return this.value;
};

function isChain (node) {
	return node instanceof Chain;
}
function isMessage (node) {
	return node instanceof Message;
}
function isSymbol (node) {
	return node instanceof Symbol;
}
function isLiteral (node) {
	return node instanceof Literal;
}

function assertChain (node) {
	console.assert(isChain(node), node + ' is not a Chain');
}
function assertMessage (node) {
	console.assert(isMessage(node), node + ' is not a Message');
}
function assertSymbol (node) {
	console.assert(isSymbol(node), node + ' is not a Symbol');
}
function assertLiteral (node) {
	console.assert(isLiteral(node), node + ' is not a Literal');
}
function assertArray (node, pred) {
	console.assert(Array.isArray(node), node + ' is not a array');
	if (pred) {
		node.forEach(pred);
	}
}

module.exports = {
	Chain: Chain,
	Message: Message,
	Symbol: Symbol,
	Literal: Literal,
	
	isChain: isChain,
	isMessage: isMessage,
	isSymbol: isSymbol,
	isLiteral: isLiteral,

	assertChain: assertChain,
	assertMessage: assertMessage,
	assertSymbol: assertSymbol,
	assertLiteral: assertLiteral,
	assertArray: assertArray,
};

},{}],52:[function(require,module,exports){

var escodegen = require('escodegen');
var astTypes = require('ast-types');
var n = astTypes.namedTypes;
var b = astTypes.builders;

var parser = require('./parser');
var pratt = require('./pratt');
var ast = require('./ast');

var options = {};

function setOptions (userOptions) {
	options.wrapWithFunction = userOptions.wrapWithFunction || false;
	options.useProxy = userOptions.useProxy || false;
	options.functionName = userOptions.functionName || 'io';
	options.runtimeLib = userOptions.runtimeLib || '_io';
	options.self = userOptions.self || 'self';
}

function applyMacros (ast) {

	// A sequence is a list of chains -- a b; c d; e
	// A chain is a list of messages -- a b c
	// A message's arguments are a list of sequences -- a b; c d, e f; g h
	// An AST is a sequence

	infixOperatorMacro(ast);
	assignmentOperatorMacro(ast);

	return ast;
}

function findChainsInSequence (sequence) {

	// Performs a post-order traversal of a sequence (usually the AST)
	// and returns a list of references to all chain objects

	var allChains = [];
	function find (sequence) {
		sequence.forEach(function (chain) {
			if (chain instanceof ast.Chain) {
				chain.getMessages().forEach(function (message) {
					message.getArguments().forEach(function (arg) {
						find(arg);
					});
				});
				allChains.push(chain);
			}
		});
	}
	find(sequence);
	return allChains;
}

function assignmentOperatorMacro (astSequence) {

	// Rewrites messages containing assignment operators
	// with setSlot messages

	var chains = findChainsInSequence(astSequence);

	while (chains.length > 0) {
		var chain = chains.pop();

		for (var i=0; i<chain.getMessages().length; i++) {
			var message = chain.getMessages()[i];

			// Find an assignment operator
			if (message.getSymbolValue() !== ":=") continue;

			// Pick the previous two elements in the chain.
			// They are the target and the slot on the target that
			// is being assigned:
			// a b := c

			var target, slotName;

			if (i === 0) {
				// := b
				throw new Error("SyntaxError: no target for assignment operator");
			} else if (i === 1) {
				// a := b

				// target defaults to Lobby
				// TODO: even in method bodies! this has to be
				// done during compilation when scope is known

				target = new ast.Message(new ast.Symbol(new ast.Literal('identifier', 'Lobby'), []));
				slotName = chain.getMessages()[0];
			} else {
				// a b := c
				target = chain.getMessages()[i-2];
				slotName = chain.getMessages()[i-1];
			}

			// Rewrite the chain

			// var current = chain.getMessages()[i];
			// var prevTwo = chain.getMessages().slice(Math.max(i-2,0), i);
			var beforeThose = chain.getMessages().slice(0, Math.max(i-2, 0));
			var after = chain.getMessages().slice(i+1, chain.getMessages().length);

			var rhs = new ast.Chain(after);
			var assignmentSlot = new ast.Chain([
				new ast.Message(
					new ast.Symbol(
						new ast.Literal('string', slotName.getSymbolValue()), [])
					)]);

			var setSlot = new ast.Message(
				new ast.Symbol(
					new ast.Literal('identifier', 'setSlot'),
					[[assignmentSlot], [rhs]]
				));

			chain.setMessages(beforeThose.concat([target, setSlot]));

			// Continue on the newly created chain in case it contains
			// more operators
			chains.push(rhs);

			break;
		
		}
	}
}

function infixOperatorMacro (astSequence) {

	// Rearranges all chains containing operators into properly
	// nested messages based on precedence

	var chains = findChainsInSequence(astSequence).filter(function (chain) {

		// Skip chains that cannot possibly contain operators
		if (chain.getMessages().length <= 1) return false;

		// A chain will be processed if it contains at least one operator
		// message with no arguments (meaning that message hasn't been processed yet)
		var hasAnOperator = chain.getMessages().filter(function (message) {
			return pratt.isOperator(message.getSymbolValue()) && message.getArguments().length === 0;
		}).length > 0;

		return hasAnOperator;
	});

	chains.forEach(function (chain) {
		chain.setMessages(pratt.parse(chain).getMessages());
	});
}

function parse (code) {

	var astSequence = parser.parse(code);

	astSequence = applyMacros(astSequence);

	var generated = astSequence.map(function (chain) {

		var proxy = b.callExpression(
			b.memberExpression(
				libraryIdentifier("Proxy"),
				b.identifier("set"),
				false),
			[b.identifier(options.self)])

		var topLevelContext = options.useProxy ? proxy : libraryIdentifier('Lobby');

		return compile(chain, topLevelContext, topLevelContext);
	});
	
	generated = b.program(generated.map(b.expressionStatement));

	if (options.wrapWithFunction) {
		generated.body[generated.body.length-1] = implicitReturnStatement(generated.body[generated.body.length-1]);
		generated = wrapInFunction(generated);
	}

	return generated;
}

function parseAndEmit (code) {
	return escodegen.generate(parse(code));
}

function wrapInFunction (program) {

	var bodyBlockStatement = b.blockStatement([
		b.variableDeclaration("var", [
			b.variableDeclarator(
				b.identifier(options.self),
				b.logicalExpression(
					"||",
					b.thisExpression(),
					b.objectExpression([])))])
		].concat(program.body));

	var propertyAccess = options.functionName.indexOf('.') !== -1;

	if (propertyAccess) {
		return b.expressionStatement(
			b.assignmentExpression(
				"=",
				b.identifier(options.functionName),
				b.functionExpression(null, [], bodyBlockStatement)));
	}
	else {
		return b.program([
			b.functionDeclaration(
				b.identifier(options.functionName),
				[],
				bodyBlockStatement)]);
	}
}

function implicitReturnStatement(expressionStatement) {

	function unwrap(expr) {
		return b.callExpression(
			b.memberExpression(
				b.identifier(options.runtimeLib),
				b.identifier("unwrapIoValue"),
				false),
			[expr]);
	}
	return b.returnStatement(unwrap(expressionStatement.expression));
}

function getEnclosingRange (exprlist) {
	function priority (s, c) {
		// line number must be smaller
		// if line number is tied, column must be smaller
	    return c.line < s.line ? c : (c.line === s.line && c.column < s.column ? c : s);
	};

	var inf = {
	    line: Infinity,
	    column: Infinity
	};

	var locInfo = exprlist
		.map(function(node) {return node.loc;})
		.filter(function(node) {return !!node;});

	if (locInfo.length > 0) {
		var start = locInfo.map(function(node) {return node.start;}).reduce(priority, inf);
		var end = locInfo.map(function(node) {return node.end;}).reduce(priority, inf);

		return {start: start, end: end};
	}

	return null;
}

function compile (node, receiver, localContext) {
	var result = {};

	if (ast.isChain(node)) {
		//  A chain is a series of left-associative messages
		var chain = node;
		var messages = chain.getMessages();

		var current;
		messages.forEach(function (message) {
			// The receiver of a message in a chain is the preceding one
			current = compile(message, receiver, localContext);
			receiver = current;
		});
		return current;
	}
	else if (ast.isMessage(node)) {
		var message = node;
		var symbolValue = message.getSymbolValue();
		var symbolType = message.getSymbolType();

		if (symbolType === 'number') {
			result = b.callExpression(
				libraryIdentifier('IoNumberWrapper'),
				[b.literal(+symbolValue)]);
		}
		else if (symbolType === 'string') {
			result = b.callExpression(
				libraryIdentifier('IoStringWrapper'),
				[b.literal(symbolValue)]);
		}
		else if (symbolType === 'identifier') {
			var jsMessageName = new b.literal(symbolValue);

			// Build the JS expression _io.receiver.send(...args)
			result = b.callExpression(
				b.memberExpression(receiver, b.identifier("send"), false),
				[jsMessageName].concat(message.getArguments().map(function (arg) {
					 // arg is a sequence -- a list of chains of messages.
					 // It gets turned into a ,-delimited JS expression.
					var result = b.sequenceExpression(
						arg.map(function (realarg) {
                            return compile(realarg, localContext, localContext);
                        }));
                    return result;
				})));

			// If the message is a special form, rewrite the resulting JS syntax tree
			if (symbolValue === "method") {

				// Replace the generated arguments
				result.arguments = [jsMessageName].concat(message.getArguments().map(function (arg) {
					// Arguments will have the locals object as context
					// arg is a sequence here also
                    return b.sequenceExpression(arg.map(function (realarg) {
						return compile(realarg, b.identifier("locals"), b.identifier("locals"));
                    }));
				}));

				// Turn all arguments but the last and first to strings;
				// they will be sent as messages to the locals object

				for (var i = 1; i < result.arguments.length - 1; i++) {
					// Each argument is a SequenceExpression
					// Grab the last expression in each sequence; it will be of the form locals.send('messageName')
					// Extract the string 'messageName' and replace the argument with it
					result.arguments[i] = result.arguments[i].expressions[result.arguments[i].expressions.length-1].arguments[0];
				}

				// The last becomes a thunk

				var lastArgument = result.arguments[result.arguments.length - 1];
				var methodBody = lastArgument;

				result.arguments[result.arguments.length - 1] = b.callExpression(
					libraryIdentifier('IoThunk'),
					[
						b.functionExpression(
							null,
							[b.identifier("locals")],
							b.blockStatement([b.returnStatement(methodBody)]))
					]);
			}
			else if (symbolValue === "if") {

				// Convert last two arguments into thunks
				// TODO handle cases where if statements have < 3 arguments

				var conseq = result.arguments[2];
				result.arguments[2] = b.callExpression(
					libraryIdentifier('IoThunk'),
					[b.functionExpression(null, [], b.blockStatement([b.returnStatement(conseq)]))]);

				var alt = result.arguments[3];
				result.arguments[3] = b.callExpression(
					libraryIdentifier('IoThunk'),
					[b.functionExpression(null, [], b.blockStatement([b.returnStatement(alt)]))]);
			}
		}
	} else {
		console.assert(false, 'Unrecognized symbol type: ' + symbolType);
	}

	return result;
}

function libraryIdentifier (id) {
	return b.memberExpression(
		b.identifier(options.runtimeLib),
		b.identifier(id),
		false);
}

module.exports = {
	parse: parse,
	compile: parseAndEmit,
	setOptions: setOptions,
};

},{"./ast":51,"./parser":54,"./pratt":55,"ast-types":19,"escodegen":27}],53:[function(require,module,exports){

var _io = (function () {

	function IoObject (slots, proto) {
		var self = {};
		self.slots = slots || {};
		self.proto = proto;

		self.identity = Math.random() + "";

		self.findSlot = IoObject.findSlot;
		self.send = IoObject.send;
		self.equals = IoObject.equals;

		return self;
	}

	IoObject.equals = function (other) {
		return this.identity === other.identity;
	};

	IoObject.findSlot = function (slot) {
		if (this.isRootObject || this.slots.hasOwnProperty(slot)) {
			return this.slots[slot];
		} else if (this.proto) {
			return this.proto.findSlot(slot);
		} else {
			return null;
		}
	};

	IoObject.send = function (message) {
		var args = Array.prototype.slice.call(arguments, 1);
		var slot = this.findSlot(message);

		if (slot) {
			if (typeof slot === 'function') {
				return slot.apply(this, args);
			} else {
				if (slot.activate) {
					return slot.activate.apply(slot, [this].concat(args));
				} else {
					return slot;
				}
			}
		} else {
			throw new Error("Object send: unrecognized message '" + message + "'");
		}
	};

	var Lobby = IoObject({type: 'Lobby'});
	Lobby.isLobby = true;

	var IoRootObject = IoObject({
		type: 'Object',
		clone: function (name, instance) {
			var slots = {};
			if (!instance) {
				slots.type = name;
			}
			return IoObject(slots, this);
		},
		slotNames: function () {
			return Object.keys(this.slots);
		},
		getSlot: function (slotName) {
			// TODO this method only works for user-defined methods for now,
			// which are IoObjects and can respond to messages.
			// At the moment all primitive methods are raw functions and won't work.
			slotName = unwrapIoValue(slotName);
			var slot = this.findSlot(slotName);
			return slot;
		},
		setSlot: function (slot, value) {
			slot = unwrapIoValue(slot);
			this.slots[slot] = value;
			return this.slots[slot];
		},
		updateSlot: function (slot, value) {
			if (this.slots[slot]) {
				this.slots[slot] = value;
			} else {
				throw new Error("Object updateSlot: slot '" + slot + "' doesn't exist; cannot update");
			}
		},
		toIoString: function () {
			return IoStringWrapper("#" + getTypeOf(this) + " " + this.send("slotNames"));
		},
		proto: function () {
			return this.proto;
		},
		println: function () {
			console.log(unwrapIoValue(this.send('toIoString')));
			return IoNil;
		},
		method: function () {
			var args = Array.prototype.slice.call(arguments);
			var parameters = args.slice(0, args.length-1);
			var thunk = args[args.length-1];

			var method = IoMethod.send('clone');
			method.slots.type = IoMethod.slots.type; // TODO get rid of this once clone properly sets the type field
			method.body = thunk;
			method.parameters = parameters;
			method.self = this;

			method.activate = function () {
				var self = arguments[0];
				var args = Array.prototype.slice.call(arguments, 1);

				var locals = IoObject({}, self);
				for (var i=0; i<args.length; i++) {
					locals.send('setSlot', IoStringWrapper(this.parameters[i]), args[i]);
					if (i > this.parameters) break; // over-application
				}
				locals.send('setSlot', IoStringWrapper('self'), self);

				return this.body.eval(locals);
			};

			return method;
		},
		if: function (condition, conseq, alt) {
			if (condition.equals(IoTrue)) {
				return conseq.eval();
			}
			else {
				return alt.eval();
			}
		},
		"==": function (other) {
			return IoBooleanWrapper(this.equals(other));
		}
	}, Lobby);
	IoRootObject.isRootObject = true;

	var IoNil = IoObject({
		type: 'Nil',
		toIoString: function () {
			return IoStringWrapper("nil");
		}
	}, IoRootObject);

	var IoNumber = IoObject({
		type: 'Number',
		"+": function (other) {
			return IoNumberWrapper(unwrapIoValue(this) + unwrapIoValue(other));
		},
		"*": function (other) {
			return IoNumberWrapper(unwrapIoValue(this) * unwrapIoValue(other));
		},
		"-": function (other) {
			return IoNumberWrapper(unwrapIoValue(this) - unwrapIoValue(other));
		},
		"==": function (other) {
			return IoBooleanWrapper(unwrapIoValue(this) === unwrapIoValue(other));
		},
		toIoString: function () {
			return IoStringWrapper(unwrapIoValue(this));
		}
	}, IoRootObject);

	function IoNumberWrapper (value) {
		return IoObject({value: value}, IoNumber);
	}

	var IoString = IoObject({
		type: 'String',
		charAt: function (n) {
			n = unwrapIoValue(n);
			return IoStringWrapper(unwrapIoValue(this).charAt(n));
		},
		"+": function (other) {
			return IoStringWrapper(unwrapIoValue(this) + unwrapIoValue(other));
		},
		toIoString: function () {
			return this;
		}
	}, IoRootObject);
	
	function IoStringWrapper (value) {
		return IoObject({value: value}, IoString);
	}

	var IoTrue = IoObject({
		type: 'Boolean',
		and: function (other) {
			if (other.equals(this)) return this;
			else return IoFalse;
		},
		toIoString: function () {
			return IoStringWrapper("true");
		}
	}, IoRootObject);

	var IoFalse = IoObject({
		type: 'Boolean',
		and: function (other) {
			return IoFalse;
		},
		toIoString: function () {
			return IoStringWrapper("false");
		}
	}, IoRootObject);

	function IoBooleanWrapper (bool) {
		return bool ? IoTrue : IoFalse;
	}

	function IoThunk (f) {
		return {f:f, eval: function() {return f.apply(null, Array.prototype.slice.call(arguments));}};
	}

	var IoMethod = IoObject({
		type: 'Block',
		activate: null // defined later
	}, IoRootObject);

	// A proxy object for hooking into the messages of another
	// object and forwarding them, redirecting them, etc.
	// For internal use only.

	function IoProxy (forObject, action) {
		var p = IoObject({type: 'Proxy'}, forObject);
		
		p.send = function (message) {
			var result = action.apply(this, arguments);
			if (result) {
				return result;
			} else {
				return IoObject.send.apply(p, arguments);
			}
		};
		return p;
	}

	Lobby.slots['nil'] = IoNil;
	Lobby.slots['true'] = IoTrue;
	Lobby.slots['false'] = IoFalse;
	Lobby.slots['Object'] = IoRootObject;
	Lobby.slots['Lobby'] = Lobby;
	Lobby.proto = IoRootObject;

	function isJSPrimitive (value) {
		var type = typeof value;
		switch (type) {
		case 'number':
		case 'string':
		case 'boolean':
		case 'function':
			return true;
		case 'object':
			// Is there a less duck-typed way to do this?
			return value.slots === undefined;
		default:
			throw new Error('isJSPrimitive: invalid value ' + value + ' of type ' + type);
		}
	}

	function getTypeOf (ioValue) {
		if (!ioValue) {
			throw new Error('getTypeOf: attempt to get type of invalid Io value ' + ioValue);
		}

		if (typeof ioValue === 'function') {
			// Assuming this isn't a bug... the value is either a
			// native method or a wrapped external method
			return 'Block';
		}

		var type = ioValue.send('type');

		if (!type) {
			throw new Error('getTypeOf: invalid type ' + ioValue);
		}

		return type;
	}

	function unwrapIoValue (ioValue) {

		var type = getTypeOf(ioValue);

		switch (type) {
		case 'Nil':
			return undefined;
		case 'Number':
		case 'String':
			return ioValue.slots.value;
		case 'Boolean':
			return ioValue.equals(IoTrue);
		case 'Block':
			// To wrap a block, we wrap it in a function which
			// activates the original Io method when applied.
			// The appropriate Io context is kept.

			return function () {
				var args = Array.prototype.slice.call(arguments).map(_io.wrapJSValue);
				if (ioValue.activate) {
					return unwrapIoValue(ioValue.activate.apply(ioValue, [ioValue.self].concat(args)));
				} else {
					throw new Error('unwrapIoValue: Io method has type \'Block\' but does not have an activation method');
				}
			};
		default:
			var obj = {};
			Object.keys(ioValue.slots).forEach(function (slotKey) {

				var value = ioValue.slots[slotKey];
				
				// This has to be done because Io object slots might
				// contain JS primitives (the type of an IoString can't
				// be an IoString, for example - infinite loop).

				// For now it's assumed that if an Io object slot contains
				// a primitive value (and if it's not a bug), the value is a
				// library primitive and shouldn't be copied out.
				// This rule might not always hold.

				if (!isJSPrimitive(value)) {
					obj[slotKey] = unwrapIoValue(value);
				}
			});
			return obj;
		}
	}

	function wrapJSValue (jsValue) {

		if (jsValue === undefined || jsValue === null) {
			return IoNil;
		}

		var type = typeof jsValue;
		switch (type) {
		case 'number':
			return IoNumberWrapper(jsValue);
		case 'string':
			return IoStringWrapper(jsValue);
		case 'boolean':
			return IoBooleanWrapper(jsValue);
		case 'object':
			var obj = IoObject({type: 'JSObject'}, IoRootObject);
			Object.keys(jsValue).forEach(function (key) {
				obj.slots[key] = wrapJSValue(jsValue[key]);
			});
			return obj;
		case 'function':
			
			// We use the fact that most library methods are vanilla
			// functions to simply return a vanilla function.
			// Additional type safety would probably be a good idea
			// here... eventually

			return jsValue;
		default:
			throw new Error('wrapJSValue: invalid object type ' + type);
		}
	}

	// A special proxy for JavaScript interop

	var Proxy = {
		set: function(obj) {
			var actualProxy = IoProxy(Lobby, function(message) {
				if (this.obj && this.obj[message]) {
					if (typeof this.obj[message] === 'function') {
						var args = Array.prototype.slice.call(arguments, 1);
						args = args.map(_io.unwrapIoValue);
						return wrapJSValue(this.obj[message].apply(this.obj, args));
					} else {
						return wrapJSValue(this.obj[message]);
					}
				}
				return false;
			});
			actualProxy.obj = obj;

			return actualProxy;
		}
	};
	
	return {
		IoObject: IoObject,
		IoNil: IoNil,
		IoNumber: IoNumber,
		IoNumberWrapper: IoNumberWrapper,
		IoString: IoString,
		IoStringWrapper: IoStringWrapper,
		IoTrue: IoTrue,
		IoFalse: IoFalse,
		IoBooleanWrapper: IoBooleanWrapper,
		IoThunk: IoThunk,
		IoMethod: IoMethod,
		IoProxy: IoProxy,
		Lobby: Lobby,
		IoRootObject: IoRootObject,
		getTypeOf: getTypeOf,
		unwrapIoValue: unwrapIoValue,
		wrapJSValue: wrapJSValue,
		Proxy: Proxy,
	};
})();

if (typeof module !== 'undefined' && module.exports) {
	module.exports = _io;
}

},{}],54:[function(require,module,exports){
(function (process){
/* parser generated by jison 0.4.17 */
/*
  Returns a Parser object of the following structure:

  Parser: {
    yy: {}
  }

  Parser.prototype: {
    yy: {},
    trace: function(),
    symbols_: {associative list: name ==> number},
    terminals_: {associative list: number ==> name},
    productions_: [...],
    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),
    table: [...],
    defaultActions: {...},
    parseError: function(str, hash),
    parse: function(input),

    lexer: {
        EOF: 1,
        parseError: function(str, hash),
        setInput: function(input),
        input: function(),
        unput: function(str),
        more: function(),
        less: function(n),
        pastInput: function(),
        upcomingInput: function(),
        showPosition: function(),
        test_match: function(regex_match_array, rule_index),
        next: function(),
        lex: function(),
        begin: function(condition),
        popState: function(),
        _currentRules: function(),
        topState: function(),
        pushState: function(condition),

        options: {
            ranges: boolean           (optional: true ==> token location info will include a .range[] member)
            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)
            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)
        },

        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),
        rules: [...],
        conditions: {associative list: name ==> set},
    }
  }


  token location info (@$, _$, etc.): {
    first_line: n,
    last_line: n,
    first_column: n,
    last_column: n,
    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)
  }


  the parseError function receives a 'hash' object with these members for lexer and parser errors: {
    text:        (matched text)
    token:       (the produced terminal token, if any)
    line:        (yylineno)
  }
  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {
    loc:         (yylloc)
    expected:    (string describing the set of expected tokens)
    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)
  }
*/
var parser = (function(){
var o=function(k,v,o,l){for(o=o||{},l=k.length;l--;o[k[l]]=v);return o},$V0=[11,19,20,22,23,24],$V1=[2,16],$V2=[1,6],$V3=[1,7],$V4=[1,12],$V5=[1,14],$V6=[1,15],$V7=[1,17],$V8=[1,18],$V9=[1,19],$Va=[2,15],$Vb=[5,11,12,18,19,20,22,23,24],$Vc=[5,12,18],$Vd=[5,12,15,16,18],$Ve=[5,12,15,16,18,19,20,22,23,24],$Vf=[5,11,12,15,16,18,19,20,22,23,24],$Vg=[12,18];
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"program":3,"looselyTerminatedExpr":4,"EOF":5,"zeroOrMoreTerminators":6,"exprs":7,"oneOrMoreTerminators":8,"expr":9,"message":10,"(":11,")":12,"symbol":13,"arguments":14,"NEWLINE":15,";":16,"argumentList":17,",":18,"IDENTIFIER":19,"NUMBER":20,"string":21,"EmptyString":22,"QuotedString":23,"QuotedStringEscape":24,"quotedstring":25,"$accept":0,"$end":1},
terminals_: {2:"error",5:"EOF",11:"(",12:")",15:"NEWLINE",16:";",18:",",19:"IDENTIFIER",20:"NUMBER",22:"EmptyString",23:"QuotedString",24:"QuotedStringEscape",25:"quotedstring"},
productions_: [0,[3,2],[3,1],[4,3],[7,3],[7,1],[9,2],[9,1],[9,3],[10,1],[10,2],[8,2],[8,1],[8,2],[8,1],[6,1],[6,0],[14,2],[14,3],[17,1],[17,3],[13,1],[13,1],[13,1],[21,1],[21,1],[21,1],[21,2],[21,2]],
performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */) {
/* this == yyval */

var $0 = $$.length - 1;
switch (yystate) {
case 1:
return $$[$0-1];
break;
case 2:
return [];
break;
case 3: case 8: case 18:
this.$ = $$[$0-1];
break;
case 4:
$$[$0-2].push($$[$0]); this.$ = $$[$0-2];
break;
case 5: case 19:
this.$ = [$$[$0]];
break;
case 6:
$$[$0-1].getMessages().push(new ast.Message($$[$0])); this.$ = $$[$0-1];
break;
case 7:
this.$ = new ast.Chain([new ast.Message($$[$0])]);
break;
case 9:

            this.$ = new ast.Symbol($$[$0], []);
        
break;
case 10:

            this.$ = new ast.Symbol($$[$0-1], $$[$0]);
        
break;
case 17:
this.$ = [];
break;
case 20:
$$[$0-2].push($$[$0]); this.$ = $$[$0-2]; 
break;
case 21:
this.$ = new ast.Literal('identifier', $$[$0]);
break;
case 22:
this.$ = new ast.Literal('number', $$[$0]);
break;
case 23:
this.$ = new ast.Literal('string', $$[$0]);
break;
case 24:

        this.$ = '';
    
break;
case 26:

        switch (yytext)
        {
            case 'b':       this.$ = '\b'; break;
            case 'n':       this.$ = '\n'; break;
            case 'r':       this.$ = '\r'; break;
            case 't':       this.$ = '\t'; break;
            case "'":       this.$ = "'"; break;
            case '"':       this.$ = '"'; break;
            case '\\':      this.$ = '\\'; break;
            case '\n':
            case '\r\n':    this.$ = ''; break;
            default:        this.$ = '\\' + $$[$0]; break;
        }
    
break;
case 27:

        switch ($$[$0-1])
        {
            case 'b':       this.$ = '\b'; break;
            case 'n':       this.$ = '\n'; break;
            case 'r':       this.$ = '\r'; break;
            case 't':       this.$ = '\t'; break;
            case "'":       this.$ = "'"; break;
            case '"':       this.$ = '"'; break;
            case '\\':      this.$ = '\\'; break;
            case '\n':
            case '\r\n':    this.$ = ''; break;
            default:        this.$ = '\\' + $$[$0-1]; break;
        }
        this.$ += $$[$0];
    
break;
case 28:

        this.$ = $$[$0-1] + $$[$0];
    
break;
}
},
table: [o($V0,$V1,{3:1,4:2,6:4,8:5,5:[1,3],15:$V2,16:$V3}),{1:[3]},{5:[1,8]},{1:[2,2]},{7:9,9:10,10:11,11:$V4,13:13,19:$V5,20:$V6,21:16,22:$V7,23:$V8,24:$V9},o($V0,$Va),o($Vb,[2,12],{8:20,15:$V2,16:$V3}),o($Vb,[2,14],{8:21,15:$V2,16:$V3}),{1:[2,1]},o($Vc,$V1,{6:22,8:23,15:$V2,16:$V3}),o($Vd,[2,5],{13:13,21:16,10:24,19:$V5,20:$V6,22:$V7,23:$V8,24:$V9}),o($Ve,[2,7]),{9:25,10:11,11:$V4,13:13,19:$V5,20:$V6,21:16,22:$V7,23:$V8,24:$V9},o($Ve,[2,9],{14:26,11:[1,27]}),o($Vf,[2,21]),o($Vf,[2,22]),o($Vf,[2,23]),o($Vf,[2,24]),o($Vf,[2,25],{25:[1,28]}),o($Vf,[2,26],{25:[1,29]}),o($Vb,[2,11]),o($Vb,[2,13]),o($Vc,[2,3]),o($Vc,$Va,{10:11,13:13,21:16,9:30,11:$V4,19:$V5,20:$V6,22:$V7,23:$V8,24:$V9}),o($Ve,[2,6]),{10:24,12:[1,31],13:13,19:$V5,20:$V6,21:16,22:$V7,23:$V8,24:$V9},o($Ve,[2,10]),o($V0,$V1,{6:4,8:5,17:33,4:34,12:[1,32],15:$V2,16:$V3}),o($Vf,[2,28]),o($Vf,[2,27]),o($Vd,[2,4],{13:13,21:16,10:24,19:$V5,20:$V6,22:$V7,23:$V8,24:$V9}),o($Ve,[2,8]),o($Ve,[2,17]),{12:[1,35],18:[1,36]},o($Vg,[2,19]),o($Ve,[2,18]),o($V0,$V1,{6:4,8:5,4:37,15:$V2,16:$V3}),o($Vg,[2,20])],
defaultActions: {3:[2,2],8:[2,1]},
parseError: function parseError(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        function _parseError (msg, hash) {
            this.message = msg;
            this.hash = hash;
        }
        _parseError.prototype = Error;

        throw new _parseError(str, hash);
    }
},
parse: function parse(input) {
    var self = this, stack = [0], tstack = [], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    var args = lstack.slice.call(arguments, 1);
    var lexer = Object.create(this.lexer);
    var sharedState = { yy: {} };
    for (var k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
            sharedState.yy[k] = this.yy[k];
        }
    }
    lexer.setInput(input, sharedState.yy);
    sharedState.yy.lexer = lexer;
    sharedState.yy.parser = this;
    if (typeof lexer.yylloc == 'undefined') {
        lexer.yylloc = {};
    }
    var yyloc = lexer.yylloc;
    lstack.push(yyloc);
    var ranges = lexer.options && lexer.options.ranges;
    if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    _token_stack:
        var lex = function () {
            var token;
            token = lexer.lex() || EOF;
            if (typeof token !== 'number') {
                token = self.symbols_[token] || token;
            }
            return token;
        };
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == 'undefined') {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
                    if (typeof action === 'undefined' || !action.length || !action[0]) {
                var errStr = '';
                expected = [];
                for (p in table[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push('\'' + this.terminals_[p] + '\'');
                    }
                }
                if (lexer.showPosition) {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ':\n' + lexer.showPosition() + '\nExpecting ' + expected.join(', ') + ', got \'' + (this.terminals_[symbol] || symbol) + '\'';
                } else {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == EOF ? 'end of input' : '\'' + (this.terminals_[symbol] || symbol) + '\'');
                }
                this.parseError(errStr, {
                    text: lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: lexer.yylineno,
                    loc: yyloc,
                    expected: expected
                });
            }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(lexer.yytext);
            lstack.push(lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = lexer.yyleng;
                yytext = lexer.yytext;
                yylineno = lexer.yylineno;
                yyloc = lexer.yylloc;
                if (recovering > 0) {
                    recovering--;
                }
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
                first_line: lstack[lstack.length - (len || 1)].first_line,
                last_line: lstack[lstack.length - 1].last_line,
                first_column: lstack[lstack.length - (len || 1)].first_column,
                last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
                yyval._$.range = [
                    lstack[lstack.length - (len || 1)].range[0],
                    lstack[lstack.length - 1].range[1]
                ];
            }
            r = this.performAction.apply(yyval, [
                yytext,
                yyleng,
                yylineno,
                sharedState.yy,
                action[1],
                vstack,
                lstack
            ].concat(args));
            if (typeof r !== 'undefined') {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}};

    // This is done in place of setting yy because the latter wouldn't work.
    var ast = require('./ast');
/* generated by jison-lex 0.3.4 */
var lexer = (function(){
var lexer = ({

EOF:1,

parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

// resets the lexer, sets new input
setInput:function (input, yy) {
        this.yy = yy || this.yy || {};
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

// consumes and returns one char from the input
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

// unshifts one char (or a string) into the input
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

// When called from action, caches matched text and appends it on next action
more:function () {
        this._more = true;
        return this;
    },

// When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
reject:function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

// retain first n characters of the match
less:function (n) {
        this.unput(this.match.slice(n));
    },

// displays already matched input, i.e. for error messages
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

// displays upcoming input, i.e. for error messages
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

// displays the character position where the lexing error occurred, i.e. for error messages
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

// test the lexed token: return FALSE when not a match, otherwise return token
test_match:function (match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
                yylineno: this.yylineno,
                yylloc: {
                    first_line: this.yylloc.first_line,
                    last_line: this.last_line,
                    first_column: this.yylloc.first_column,
                    last_column: this.yylloc.last_column
                },
                yytext: this.yytext,
                match: this.match,
                matches: this.matches,
                matched: this.matched,
                yyleng: this.yyleng,
                offset: this.offset,
                _more: this._more,
                _input: this._input,
                yy: this.yy,
                conditionStack: this.conditionStack.slice(0),
                done: this.done
            };
            if (this.options.ranges) {
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
            first_line: this.yylloc.last_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.last_column,
            last_column: lines ?
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

// return next match in input
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

// return next match that has a token
lex:function lex() {
        var r = this.next();
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

// activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },

// pop the previously active lexer condition state off the condition stack
popState:function popState() {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
            return this.conditionStack[0];
        }
    },

// produce the lexer rule set which is active for the currently active lexer condition state
_currentRules:function _currentRules() {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

// return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
topState:function topState(n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

// alias for begin(condition)
pushState:function pushState(condition) {
        this.begin(condition);
    },

// return the number of states currently on the stack
stateStackSize:function stateStackSize() {
        return this.conditionStack.length;
    },
options: {},
performAction: function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {
var YYSTATE=YY_START;
switch($avoiding_name_collisions) {
case 0:
break;
case 1:
break;
case 2:
break;
case 3:return 20
break;
case 4:return 19
break;
case 5:return 11
break;
case 6:return 12
break;
case 7:return 15
break;
case 8:return 16
break;
case 9:return 18
break;
case 10:return 22
break;
case 11:this.begin('DoubleQuotedString');
break;
case 12:this.begin('QuotedStringEscape');
break;
case 13:this.popState();
break;
case 14: /* The newlines are there because we can span strings across lines using \ */
                                            this.popState();
                                            return 24;
                                        
break;
case 15:return 23;
break;
case 16:return 5
break;
case 17:return 'INVALID'
break;
}
},
rules: [/^(?:[ \t]+)/,/^(?:(#|\/\/)[^\r\n]*)/,/^(?:\/\*([\u0000-\uffff]*?)\*\/)/,/^(?:\b[0-9]+(\.[0-9]+)?\b)/,/^(?:[^()\[\]{}",;\s]+)/,/^(?:\()/,/^(?:\))/,/^(?:\r?\n)/,/^(?:;)/,/^(?:,)/,/^(?:"")/,/^(?:")/,/^(?:\\)/,/^(?:")/,/^(?:(.|\r\n|\n))/,/^(?:[^"\\]*)/,/^(?:$)/,/^(?:.)/],
conditions: {"QuotedStringEscape":{"rules":[14],"inclusive":false},"DoubleQuotedString":{"rules":[12,13,15],"inclusive":false},"INITIAL":{"rules":[0,1,2,3,4,5,6,7,8,9,10,11,16,17],"inclusive":true}}
});
return lexer;
})();
parser.lexer = lexer;
function Parser () {
  this.yy = {};
}
Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();


if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = parser;
exports.Parser = parser.Parser;
exports.parse = function () { return parser.parse.apply(parser, arguments); };
exports.main = function commonjsMain(args) {
    if (!args[1]) {
        console.log('Usage: '+args[0]+' FILE');
        process.exit(1);
    }
    var source = require('fs').readFileSync(require('path').normalize(args[1]), "utf8");
    return exports.parser.parse(source);
};
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(process.argv.slice(1));
}
}
}).call(this,require("g5I+bs"))
},{"./ast":51,"fs":21,"g5I+bs":37,"path":36}],55:[function(require,module,exports){

var ast = require('./ast');

function Chain (left, op, right) {
	var result = new ast.Chain([left, op]);
	// TODO Should this be a chain instead? .push(new ast.Chain([right]))?
	// should be sorted out when the exact type of the args list is determined
	//op.getArguments().push([right]); //Commented this out, was arguments added to chain without using parentethis
	return result;
}

// Parser

var input = [];
var ptr = 0;

function consume () {
	return input[ptr++];
}

function lookahead () {
	return input[ptr];
}

// Token-handling

function parseId (token) {
	return token;
}

// function parsePrefixOp (token) {
// 	var operand = parseExpression(PREFIX);
// 	return Application(token.value, [operand]);
// }

function makeInfixOp (precedence) {
	var parser = function (left, op) {
		var right = parseExpression(precedence);
		return Chain(left, op, right);
	};
	parser.precedence = precedence;
	return parser;
}

// function parsePostfixOp (left, token) {
// 	return Application(token.value, [left]);
// }

// function parseMixfixOp (left, token) {
// 	var conseq = parseExpression(CONDITIONAL);
// 	consume();
// 	var alt = parseExpression(CONDITIONAL);
// 	consume();
// 	return Application(token.value, [left, conseq, alt]);
// }

// var prefixOperators = {
// 	"+": parsePrefixOp,
// 	"-": parsePrefixOp,
// 	"~": parsePrefixOp,
// 	"!": parsePrefixOp
// };

// var ASSIGNMENT = 1;
// var CONDITIONAL = 2;
var BOOLEAN = 2;
var COMPARISON = 3;
var SUM = 4;
var PRODUCT = 5;
// var EXPONENT = 6;
// var PREFIX = 7;
// var POSTFIX = 8;
// var CALL = 9;

var otherOperators = {
	"+": makeInfixOp(SUM),
	"-": makeInfixOp(SUM),
	"*": makeInfixOp(PRODUCT),
	"==": makeInfixOp(COMPARISON),
	"and": makeInfixOp(BOOLEAN),
	// "/": makeInfixOp(PRODUCT),
	// "?": parseMixfixOp
};

function isOperator (token) {
	return !!otherOperators[token];
}

function getPrecedence (token) {
	if (token.type === 'EOF') return 0;

	var opParser = otherOperators[token.getSymbolValue()];
	if (opParser) return opParser.precedence;

	return 0;
}

function parseExpression (precedence) {
	var message = consume();
	
	// var prefixParser = symbol.value.value === "number" ? parseId : prefixOperators[message.value];
	// if (!prefixParser) {
	// 	throw new Error('unrecognized message ' + message.value);
	// }
	var prefixParser = parseId; // Assume there are no prefix operators for now
	var left = prefixParser(message);

	while (precedence < getPrecedence(message = lookahead())) {
		var infixParser = otherOperators[message.getSymbolValue()];

		if (!infixParser) {
			return left;
		}

		consume();

		left = infixParser(left, message);
	}

	return left;
}

module.exports = {
	parse: function (chain) {
		// Don't accept anything but a chain
		if (!(ast.isChain(chain))) return chain;

		// Initialize parser
		ptr = 0;
		input = chain.getMessages().slice();
		input.push({type: 'EOF'});

		return parseExpression(0);
	},
	isOperator: isOperator
};
},{"./ast":51}]},{},[])