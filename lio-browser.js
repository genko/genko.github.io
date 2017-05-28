require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

}).call(this,require('_process'),"/node_modules/amdefine/amdefine.js")
},{"_process":31,"path":30}],2:[function(require,module,exports){
module.exports = function (fork) {
    fork.use(require("./es7"));

    var types = fork.use(require("../lib/types"));
    var defaults = fork.use(require("../lib/shared")).defaults;
    var def = types.Type.def;
    var or = types.Type.or;

    def("Noop")
        .bases("Node")
        .build();

    def("DoExpression")
        .bases("Expression")
        .build("body")
        .field("body", [def("Statement")]);

    def("Super")
        .bases("Expression")
        .build();

    def("BindExpression")
        .bases("Expression")
        .build("object", "callee")
        .field("object", or(def("Expression"), null))
        .field("callee", def("Expression"));

    def("Decorator")
        .bases("Node")
        .build("expression")
        .field("expression", def("Expression"));

    def("Property")
        .field("decorators",
            or([def("Decorator")], null),
            defaults["null"]);

    def("MethodDefinition")
        .field("decorators",
            or([def("Decorator")], null),
            defaults["null"]);

    def("MetaProperty")
        .bases("Expression")
        .build("meta", "property")
        .field("meta", def("Identifier"))
        .field("property", def("Identifier"));

    def("ParenthesizedExpression")
        .bases("Expression")
        .build("expression")
        .field("expression", def("Expression"));

    def("ImportSpecifier")
        .bases("ModuleSpecifier")
        .build("imported", "local")
        .field("imported", def("Identifier"));

    def("ImportDefaultSpecifier")
        .bases("ModuleSpecifier")
        .build("local");

    def("ImportNamespaceSpecifier")
        .bases("ModuleSpecifier")
        .build("local");

    def("ExportDefaultDeclaration")
        .bases("Declaration")
        .build("declaration")
        .field("declaration", or(def("Declaration"), def("Expression")));

    def("ExportNamedDeclaration")
        .bases("Declaration")
        .build("declaration", "specifiers", "source")
        .field("declaration", or(def("Declaration"), null))
        .field("specifiers", [def("ExportSpecifier")], defaults.emptyArray)
        .field("source", or(def("Literal"), null), defaults["null"]);

    def("ExportSpecifier")
        .bases("ModuleSpecifier")
        .build("local", "exported")
        .field("exported", def("Identifier"));

    def("ExportNamespaceSpecifier")
        .bases("Specifier")
        .build("exported")
        .field("exported", def("Identifier"));

    def("ExportDefaultSpecifier")
        .bases("Specifier")
        .build("exported")
        .field("exported", def("Identifier"));

    def("ExportAllDeclaration")
        .bases("Declaration")
        .build("exported", "source")
        .field("exported", or(def("Identifier"), null))
        .field("source", def("Literal"));

    def("CommentBlock")
        .bases("Comment")
        .build("value", /*optional:*/ "leading", "trailing");

    def("CommentLine")
        .bases("Comment")
        .build("value", /*optional:*/ "leading", "trailing");
};
},{"../lib/shared":19,"../lib/types":20,"./es7":8}],3:[function(require,module,exports){
module.exports = function (fork) {
  fork.use(require("./babel"));

  // var types = fork.types;
  var types = fork.use(require("../lib/types"));
  // var defaults = fork.shared.defaults;
  var defaults = fork.use(require("../lib/shared")).defaults;
  var def = types.Type.def;
  var or = types.Type.or;

  def("Directive")
    .bases("Node")
    .build("value")
    .field("value", def("DirectiveLiteral"));

  def("DirectiveLiteral")
    .bases("Node", "Expression")
    .build("value")
    .field("value", String, defaults["use strict"]);

  def("BlockStatement")
    .bases("Statement")
    .build("body")
    .field("body", [def("Statement")])
    .field("directives", [def("Directive")], defaults.emptyArray);

  def("Program")
    .bases("Node")
    .build("body")
    .field("body", [def("Statement")])
    .field("directives", [def("Directive")], defaults.emptyArray);

  // Split Literal
  def("StringLiteral")
    .bases("Literal")
    .build("value")
    .field("value", String);

  def("NumericLiteral")
    .bases("Literal")
    .build("value")
    .field("value", Number);

  def("NullLiteral")
    .bases("Literal")
    .build()
    .field("value", null, defaults["null"]);

  def("BooleanLiteral")
    .bases("Literal")
    .build("value")
    .field("value", Boolean);

  def("RegExpLiteral")
    .bases("Literal")
    .build("pattern", "flags")
    .field("pattern", String)
    .field("flags", String)
    .field("value", RegExp, function () {
      return new RegExp(this.pattern, this.flags);
    });

  var ObjectExpressionProperty = or(
    def("Property"),
    def("ObjectMethod"),
    def("ObjectProperty"),
    def("SpreadProperty")
  );

  // Split Property -> ObjectProperty and ObjectMethod
  def("ObjectExpression")
    .bases("Expression")
    .build("properties")
    .field("properties", [ObjectExpressionProperty]);

  // ObjectMethod hoist .value properties to own properties
  def("ObjectMethod")
    .bases("Node", "Function")
    .build("kind", "key", "params", "body", "computed")
    .field("kind", or("method", "get", "set"))
    .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
    .field("params", [def("Pattern")])
    .field("body", def("BlockStatement"))
    .field("computed", Boolean, defaults["false"])
    .field("generator", Boolean, defaults["false"])
    .field("async", Boolean, defaults["false"])
    .field("decorators",
           or([def("Decorator")], null),
           defaults["null"]);

  def("ObjectProperty")
    .bases("Node")
    .build("key", "value")
    .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
    .field("value", or(def("Expression"), def("Pattern")))
    .field("computed", Boolean, defaults["false"]);

  var ClassBodyElement = or(
    def("MethodDefinition"),
    def("VariableDeclarator"),
    def("ClassPropertyDefinition"),
    def("ClassProperty"),
    def("ClassMethod")
  );

  // MethodDefinition -> ClassMethod
  def("ClassBody")
    .bases("Declaration")
    .build("body")
    .field("body", [ClassBodyElement]);

  def("ClassMethod")
    .bases("Declaration", "Function")
    .build("kind", "key", "params", "body", "computed", "static")
    .field("kind", or("get", "set", "method", "constructor"))
    .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
    .field("params", [def("Pattern")])
    .field("body", def("BlockStatement"))
    .field("computed", Boolean, defaults["false"])
    .field("static", Boolean, defaults["false"])
    .field("generator", Boolean, defaults["false"])
    .field("async", Boolean, defaults["false"])
    .field("decorators",
           or([def("Decorator")], null),
           defaults["null"]);

  var ObjectPatternProperty = or(
    def("Property"),
    def("PropertyPattern"),
    def("SpreadPropertyPattern"),
    def("SpreadProperty"), // Used by Esprima
    def("ObjectProperty"), // Babel 6
    def("RestProperty") // Babel 6
  );

  // Split into RestProperty and SpreadProperty
  def("ObjectPattern")
    .bases("Pattern")
    .build("properties")
    .field("properties", [ObjectPatternProperty])
    .field("decorators",
           or([def("Decorator")], null),
           defaults["null"]);

  def("SpreadProperty")
    .bases("Node")
    .build("argument")
    .field("argument", def("Expression"));

  def("RestProperty")
    .bases("Node")
    .build("argument")
    .field("argument", def("Expression"));

  def("ForAwaitStatement")
    .bases("Statement")
    .build("left", "right", "body")
    .field("left", or(
      def("VariableDeclaration"),
      def("Expression")))
    .field("right", def("Expression"))
    .field("body", def("Statement"));

  // The callee node of a dynamic import(...) expression.
  def("Import")
    .bases("Expression")
    .build();
};

},{"../lib/shared":19,"../lib/types":20,"./babel":2}],4:[function(require,module,exports){
module.exports = function (fork) {
  fork.use(require("./babel6-core"));
  fork.use(require("./flow"));
};

},{"./babel6-core":3,"./flow":10}],5:[function(require,module,exports){
module.exports = function (fork) {
    var types = fork.use(require("../lib/types"));
    var Type = types.Type;
    var def = Type.def;
    var or = Type.or;
    var shared = fork.use(require("../lib/shared"));
    var defaults = shared.defaults;
    var geq = shared.geq;

    // Abstract supertype of all syntactic entities that are allowed to have a
    // .loc field.
    def("Printable")
        .field("loc", or(
            def("SourceLocation"),
            null
        ), defaults["null"], true);

    def("Node")
        .bases("Printable")
        .field("type", String)
        .field("comments", or(
            [def("Comment")],
            null
        ), defaults["null"], true);

    def("SourceLocation")
        .build("start", "end", "source")
        .field("start", def("Position"))
        .field("end", def("Position"))
        .field("source", or(String, null), defaults["null"]);

    def("Position")
        .build("line", "column")
        .field("line", geq(1))
        .field("column", geq(0));

    def("File")
        .bases("Node")
        .build("program", "name")
        .field("program", def("Program"))
        .field("name", or(String, null), defaults["null"]);

    def("Program")
        .bases("Node")
        .build("body")
        .field("body", [def("Statement")]);

    def("Function")
        .bases("Node")
        .field("id", or(def("Identifier"), null), defaults["null"])
        .field("params", [def("Pattern")])
        .field("body", def("BlockStatement"));

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
        .field("lexical", Boolean, defaults["false"]);

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
        .field("handler", or(def("CatchClause"), null), function () {
            return this.handlers && this.handlers[0] || null;
        })
        .field("handlers", [def("CatchClause")], function () {
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
        .build("left", "right", "body")
        .field("left", or(
            def("VariableDeclaration"),
            def("Expression")))
        .field("right", def("Expression"))
        .field("body", def("Statement"));

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
        .field("declarations", [def("VariableDeclarator")]);

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
        // Esprima doesn't bother with this field, presumably because it's
        // always true for unary operators.
        .field("prefix", Boolean, defaults["true"]);

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
        .field("prefix", Boolean);

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
        .field("computed", Boolean, function () {
            var type = this.property.type;
            if (type === 'Literal' ||
                type === 'MemberExpression' ||
                type === 'BinaryExpression') {
                return true;
            }
            return false;
        });

    def("Pattern").bases("Node");

    def("SwitchCase")
        .bases("Node")
        .build("test", "consequent")
        .field("test", or(def("Expression"), null))
        .field("consequent", [def("Statement")]);

    def("Identifier")
        // But aren't Expressions and Patterns already Nodes? TODO Report this.
        .bases("Node", "Expression", "Pattern")
        .build("name")
        .field("name", String);

    def("Literal")
        // But aren't Expressions already Nodes? TODO Report this.
        .bases("Node", "Expression")
        .build("value")
        .field("value", or(String, Boolean, null, Number, RegExp))
        .field("regex", or({
            pattern: String,
            flags: String
        }, null), function () {
            if (this.value instanceof RegExp) {
                var flags = "";

                if (this.value.ignoreCase) flags += "i";
                if (this.value.multiline) flags += "m";
                if (this.value.global) flags += "g";

                return {
                    pattern: this.value.source,
                    flags: flags
                };
            }

            return null;
        });

    // Abstract (non-buildable) comment supertype. Not a Node.
    def("Comment")
        .bases("Printable")
        .field("value", String)
        // A .leading comment comes before the node, whereas a .trailing
        // comment comes after it. These two fields should not both be true,
        // but they might both be false when the comment falls inside a node
        // and the node has no children for the comment to lead or trail,
        // e.g. { /*dangling*/ }.
        .field("leading", Boolean, defaults["true"])
        .field("trailing", Boolean, defaults["false"]);
};
},{"../lib/shared":19,"../lib/types":20}],6:[function(require,module,exports){
module.exports = function (fork) {
    fork.use(require("./core"));
    var types = fork.use(require("../lib/types"));
    var def = types.Type.def;
    var or = types.Type.or;

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
        .field("computed", Boolean);

    def("XMLFunctionQualifiedIdentifier")
        .bases("Expression")
        .field("right", or(def("Identifier"), def("Expression")))
        .field("computed", Boolean);

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
        .field("text", String);

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
        .field("contents", or(String, [def("XML")]));

    def("XMLAttribute")
        .bases("XML")
        .field("value", String);

    def("XMLCdata")
        .bases("XML")
        .field("contents", String);

    def("XMLComment")
        .bases("XML")
        .field("contents", String);

    def("XMLProcessingInstruction")
        .bases("XML")
        .field("target", String)
        .field("contents", or(String, null));
};
},{"../lib/types":20,"./core":5}],7:[function(require,module,exports){
module.exports = function (fork) {
  fork.use(require("./core"));
  var types = fork.use(require("../lib/types"));
  var def = types.Type.def;
  var or = types.Type.or;
  var defaults = fork.use(require("../lib/shared")).defaults;

  def("Function")
    .field("generator", Boolean, defaults["false"])
    .field("expression", Boolean, defaults["false"])
    .field("defaults", [or(def("Expression"), null)], defaults.emptyArray)
    // TODO This could be represented as a RestElement in .params.
    .field("rest", or(def("Identifier"), null), defaults["null"]);

  // The ESTree way of representing a ...rest parameter.
  def("RestElement")
    .bases("Pattern")
    .build("argument")
    .field("argument", def("Pattern"));

  def("SpreadElementPattern")
    .bases("Pattern")
    .build("argument")
    .field("argument", def("Pattern"));

  def("FunctionDeclaration")
    .build("id", "params", "body", "generator", "expression");

  def("FunctionExpression")
    .build("id", "params", "body", "generator", "expression");

  // The Parser API calls this ArrowExpression, but Esprima and all other
  // actual parsers use ArrowFunctionExpression.
  def("ArrowFunctionExpression")
    .bases("Function", "Expression")
    .build("params", "body", "expression")
    // The forced null value here is compatible with the overridden
    // definition of the "id" field in the Function interface.
    .field("id", null, defaults["null"])
    // Arrow function bodies are allowed to be expressions.
    .field("body", or(def("BlockStatement"), def("Expression")))
    // The current spec forbids arrow generators, so I have taken the
    // liberty of enforcing that. TODO Report this.
    .field("generator", false, defaults["false"]);

  def("ForOfStatement")
    .bases("Statement")
    .build("left", "right", "body")
    .field("left", or(
      def("VariableDeclaration"),
      def("Pattern")))
    .field("right", def("Expression"))
    .field("body", def("Statement"));

  def("YieldExpression")
    .bases("Expression")
    .build("argument", "delegate")
    .field("argument", or(def("Expression"), null))
    .field("delegate", Boolean, defaults["false"]);

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
    .field("each", Boolean);

  def("Property")
    .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
    .field("value", or(def("Expression"), def("Pattern")))
    .field("method", Boolean, defaults["false"])
    .field("shorthand", Boolean, defaults["false"])
    .field("computed", Boolean, defaults["false"]);

  def("PropertyPattern")
    .bases("Pattern")
    .build("key", "pattern")
    .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
    .field("pattern", def("Pattern"))
    .field("computed", Boolean, defaults["false"]);

  def("ObjectPattern")
    .bases("Pattern")
    .build("properties")
    .field("properties", [or(def("PropertyPattern"), def("Property"))]);

  def("ArrayPattern")
    .bases("Pattern")
    .build("elements")
    .field("elements", [or(def("Pattern"), null)]);

  def("MethodDefinition")
    .bases("Declaration")
    .build("kind", "key", "value", "static")
    .field("kind", or("constructor", "method", "get", "set"))
    .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
    .field("value", def("Function"))
    .field("computed", Boolean, defaults["false"])
    .field("static", Boolean, defaults["false"]);

  def("SpreadElement")
    .bases("Node")
    .build("argument")
    .field("argument", def("Expression"));

  def("ArrayExpression")
    .field("elements", [or(
      def("Expression"),
      def("SpreadElement"),
      def("RestElement"),
      null
    )]);

  def("NewExpression")
    .field("arguments", [or(def("Expression"), def("SpreadElement"))]);

  def("CallExpression")
    .field("arguments", [or(def("Expression"), def("SpreadElement"))]);

  // Note: this node type is *not* an AssignmentExpression with a Pattern on
  // the left-hand side! The existing AssignmentExpression type already
  // supports destructuring assignments. AssignmentPattern nodes may appear
  // wherever a Pattern is allowed, and the right-hand side represents a
  // default value to be destructured against the left-hand side, if no
  // value is otherwise provided. For example: default parameter values.
  def("AssignmentPattern")
    .bases("Pattern")
    .build("left", "right")
    .field("left", def("Pattern"))
    .field("right", def("Expression"));

  var ClassBodyElement = or(
    def("MethodDefinition"),
    def("VariableDeclarator"),
    def("ClassPropertyDefinition"),
    def("ClassProperty")
  );

  def("ClassProperty")
    .bases("Declaration")
    .build("key")
    .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
    .field("computed", Boolean, defaults["false"]);

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
    .field("id", or(def("Identifier"), null))
    .field("body", def("ClassBody"))
    .field("superClass", or(def("Expression"), null), defaults["null"]);

  def("ClassExpression")
    .bases("Expression")
    .build("id", "body", "superClass")
    .field("id", or(def("Identifier"), null), defaults["null"])
    .field("body", def("ClassBody"))
    .field("superClass", or(def("Expression"), null), defaults["null"])
    .field("implements", [def("ClassImplements")], defaults.emptyArray);

  def("ClassImplements")
    .bases("Node")
    .build("id")
    .field("id", def("Identifier"))
    .field("superClass", or(def("Expression"), null), defaults["null"]);

  // Specifier and ModuleSpecifier are abstract non-standard types
  // introduced for definitional convenience.
  def("Specifier").bases("Node");

  // This supertype is shared/abused by both def/babel.js and
  // def/esprima.js. In the future, it will be possible to load only one set
  // of definitions appropriate for a given parser, but until then we must
  // rely on default functions to reconcile the conflicting AST formats.
  def("ModuleSpecifier")
    .bases("Specifier")
    // This local field is used by Babel/Acorn. It should not technically
    // be optional in the Babel/Acorn AST format, but it must be optional
    // in the Esprima AST format.
    .field("local", or(def("Identifier"), null), defaults["null"])
    // The id and name fields are used by Esprima. The id field should not
    // technically be optional in the Esprima AST format, but it must be
    // optional in the Babel/Acorn AST format.
    .field("id", or(def("Identifier"), null), defaults["null"])
    .field("name", or(def("Identifier"), null), defaults["null"]);

  def("TaggedTemplateExpression")
    .bases("Expression")
    .build("tag", "quasi")
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
    .field("value", {"cooked": String, "raw": String})
    .field("tail", Boolean);
};

},{"../lib/shared":19,"../lib/types":20,"./core":5}],8:[function(require,module,exports){
module.exports = function (fork) {
    fork.use(require('./es6'));

    var types = fork.use(require("../lib/types"));
    var def = types.Type.def;
    var or = types.Type.or;
    var builtin = types.builtInTypes;
    var defaults = fork.use(require("../lib/shared")).defaults;

    def("Function")
      .field("async", Boolean, defaults["false"]);

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
        def("Property"),
        def("PropertyPattern"),
        def("SpreadPropertyPattern")
      )]);

    def("AwaitExpression")
      .bases("Expression")
      .build("argument", "all")
      .field("argument", or(def("Expression"), null))
      .field("all", Boolean, defaults["false"]);
};
},{"../lib/shared":19,"../lib/types":20,"./es6":7}],9:[function(require,module,exports){
module.exports = function (fork) {
    fork.use(require("./es7"));

    var types = fork.use(require("../lib/types"));
    var defaults = fork.use(require("../lib/shared")).defaults;
    var def = types.Type.def;
    var or = types.Type.or;

    def("VariableDeclaration")
      .field("declarations", [or(
        def("VariableDeclarator"),
        def("Identifier") // Esprima deviation.
      )]);

    def("Property")
      .field("value", or(
        def("Expression"),
        def("Pattern") // Esprima deviation.
      ));

    def("ArrayPattern")
      .field("elements", [or(
        def("Pattern"),
        def("SpreadElement"),
        null
      )]);

    def("ObjectPattern")
      .field("properties", [or(
        def("Property"),
        def("PropertyPattern"),
        def("SpreadPropertyPattern"),
        def("SpreadProperty") // Used by Esprima.
      )]);

// Like ModuleSpecifier, except type:"ExportSpecifier" and buildable.
// export {<id [as name]>} [from ...];
    def("ExportSpecifier")
      .bases("ModuleSpecifier")
      .build("id", "name");

// export <*> from ...;
    def("ExportBatchSpecifier")
      .bases("Specifier")
      .build();

// Like ModuleSpecifier, except type:"ImportSpecifier" and buildable.
// import {<id [as name]>} from ...;
    def("ImportSpecifier")
      .bases("ModuleSpecifier")
      .build("id", "name");

// import <* as id> from ...;
    def("ImportNamespaceSpecifier")
      .bases("ModuleSpecifier")
      .build("id");

// import <id> from ...;
    def("ImportDefaultSpecifier")
      .bases("ModuleSpecifier")
      .build("id");

    def("ExportDeclaration")
      .bases("Declaration")
      .build("default", "declaration", "specifiers", "source")
      .field("default", Boolean)
      .field("declaration", or(
        def("Declaration"),
        def("Expression"), // Implies default.
        null
      ))
      .field("specifiers", [or(
        def("ExportSpecifier"),
        def("ExportBatchSpecifier")
      )], defaults.emptyArray)
      .field("source", or(
        def("Literal"),
        null
      ), defaults["null"]);

    def("ImportDeclaration")
      .bases("Declaration")
      .build("specifiers", "source", "importKind")
      .field("specifiers", [or(
        def("ImportSpecifier"),
        def("ImportNamespaceSpecifier"),
        def("ImportDefaultSpecifier")
      )], defaults.emptyArray)
      .field("source", def("Literal"))
      .field("importKind", or(
        "value",
        "type"
      ), function() {
        return "value";
      });

    def("Block")
      .bases("Comment")
      .build("value", /*optional:*/ "leading", "trailing");

    def("Line")
      .bases("Comment")
      .build("value", /*optional:*/ "leading", "trailing");
};
},{"../lib/shared":19,"../lib/types":20,"./es7":8}],10:[function(require,module,exports){
module.exports = function (fork) {
    fork.use(require("./es7"));

    var types = fork.use(require("../lib/types"));
    var def = types.Type.def;
    var or = types.Type.or;
    var defaults = fork.use(require("../lib/shared")).defaults;

    // Type Annotations
    def("Type").bases("Node");

    def("AnyTypeAnnotation")
      .bases("Type")
      .build();

    def("EmptyTypeAnnotation")
      .bases("Type")
      .build();

    def("MixedTypeAnnotation")
      .bases("Type")
      .build();

    def("VoidTypeAnnotation")
      .bases("Type")
      .build();

    def("NumberTypeAnnotation")
      .bases("Type")
      .build();

    def("NumberLiteralTypeAnnotation")
      .bases("Type")
      .build("value", "raw")
      .field("value", Number)
      .field("raw", String);

    // Babylon 6 differs in AST from Flow
    // same as NumberLiteralTypeAnnotation
    def("NumericLiteralTypeAnnotation")
      .bases("Type")
      .build("value", "raw")
      .field("value", Number)
      .field("raw", String);

    def("StringTypeAnnotation")
      .bases("Type")
      .build();

    def("StringLiteralTypeAnnotation")
      .bases("Type")
      .build("value", "raw")
      .field("value", String)
      .field("raw", String);

    def("BooleanTypeAnnotation")
      .bases("Type")
      .build();

    def("BooleanLiteralTypeAnnotation")
      .bases("Type")
      .build("value", "raw")
      .field("value", Boolean)
      .field("raw", String);

    def("TypeAnnotation")
      .bases("Node")
      .build("typeAnnotation")
      .field("typeAnnotation", def("Type"));

    def("NullableTypeAnnotation")
      .bases("Type")
      .build("typeAnnotation")
      .field("typeAnnotation", def("Type"));

    def("NullLiteralTypeAnnotation")
      .bases("Type")
      .build();

    def("NullTypeAnnotation")
      .bases("Type")
      .build();

    def("ThisTypeAnnotation")
      .bases("Type")
      .build();

    def("ExistsTypeAnnotation")
      .bases("Type")
      .build();

    def("ExistentialTypeParam")
      .bases("Type")
      .build();

    def("FunctionTypeAnnotation")
      .bases("Type")
      .build("params", "returnType", "rest", "typeParameters")
      .field("params", [def("FunctionTypeParam")])
      .field("returnType", def("Type"))
      .field("rest", or(def("FunctionTypeParam"), null))
      .field("typeParameters", or(def("TypeParameterDeclaration"), null));

    def("FunctionTypeParam")
      .bases("Node")
      .build("name", "typeAnnotation", "optional")
      .field("name", def("Identifier"))
      .field("typeAnnotation", def("Type"))
      .field("optional", Boolean);

    def("ArrayTypeAnnotation")
      .bases("Type")
      .build("elementType")
      .field("elementType", def("Type"));

    def("ObjectTypeAnnotation")
      .bases("Type")
      .build("properties", "indexers", "callProperties")
      .field("properties", [def("ObjectTypeProperty")])
      .field("indexers", [def("ObjectTypeIndexer")], defaults.emptyArray)
      .field("callProperties",
        [def("ObjectTypeCallProperty")],
        defaults.emptyArray)
      .field("exact", Boolean, defaults["false"]);

    def("ObjectTypeProperty")
      .bases("Node")
      .build("key", "value", "optional")
      .field("key", or(def("Literal"), def("Identifier")))
      .field("value", def("Type"))
      .field("optional", Boolean)
      .field("variance",
        or("plus", "minus", null),
        defaults["null"]);

    def("ObjectTypeIndexer")
      .bases("Node")
      .build("id", "key", "value")
      .field("id", def("Identifier"))
      .field("key", def("Type"))
      .field("value", def("Type"))
      .field("variance",
        or("plus", "minus", null),
        defaults["null"]);

    def("ObjectTypeCallProperty")
      .bases("Node")
      .build("value")
      .field("value", def("FunctionTypeAnnotation"))
      .field("static", Boolean, defaults["false"]);

    def("QualifiedTypeIdentifier")
      .bases("Node")
      .build("qualification", "id")
      .field("qualification",
        or(def("Identifier"),
          def("QualifiedTypeIdentifier")))
      .field("id", def("Identifier"));

    def("GenericTypeAnnotation")
      .bases("Type")
      .build("id", "typeParameters")
      .field("id", or(def("Identifier"), def("QualifiedTypeIdentifier")))
      .field("typeParameters", or(def("TypeParameterInstantiation"), null));

    def("MemberTypeAnnotation")
      .bases("Type")
      .build("object", "property")
      .field("object", def("Identifier"))
      .field("property",
        or(def("MemberTypeAnnotation"),
          def("GenericTypeAnnotation")));

    def("UnionTypeAnnotation")
      .bases("Type")
      .build("types")
      .field("types", [def("Type")]);

    def("IntersectionTypeAnnotation")
      .bases("Type")
      .build("types")
      .field("types", [def("Type")]);

    def("TypeofTypeAnnotation")
      .bases("Type")
      .build("argument")
      .field("argument", def("Type"));

    def("Identifier")
      .field("typeAnnotation", or(def("TypeAnnotation"), null), defaults["null"]);

    def("ObjectPattern")
      .field("typeAnnotation", or(def("TypeAnnotation"), null), defaults["null"]);

    def("TypeParameterDeclaration")
      .bases("Node")
      .build("params")
      .field("params", [def("TypeParameter")]);

    def("TypeParameterInstantiation")
      .bases("Node")
      .build("params")
      .field("params", [def("Type")]);

    def("TypeParameter")
      .bases("Type")
      .build("name", "variance", "bound")
      .field("name", String)
      .field("variance",
        or("plus", "minus", null),
        defaults["null"])
      .field("bound",
        or(def("TypeAnnotation"), null),
        defaults["null"]);

    def("Function")
      .field("returnType",
        or(def("TypeAnnotation"), null),
        defaults["null"])
      .field("typeParameters",
        or(def("TypeParameterDeclaration"), null),
        defaults["null"]);

    def("ClassProperty")
      .build("key", "value", "typeAnnotation", "static")
      .field("value", or(def("Expression"), null))
      .field("typeAnnotation", or(def("TypeAnnotation"), null))
      .field("static", Boolean, defaults["false"])
      .field("variance",
        or("plus", "minus", null),
        defaults["null"]);

    def("ClassImplements")
      .field("typeParameters",
        or(def("TypeParameterInstantiation"), null),
        defaults["null"]);

    def("InterfaceDeclaration")
      .bases("Declaration")
      .build("id", "body", "extends")
      .field("id", def("Identifier"))
      .field("typeParameters",
        or(def("TypeParameterDeclaration"), null),
        defaults["null"])
      .field("body", def("ObjectTypeAnnotation"))
      .field("extends", [def("InterfaceExtends")]);

    def("DeclareInterface")
      .bases("InterfaceDeclaration")
      .build("id", "body", "extends");

    def("InterfaceExtends")
      .bases("Node")
      .build("id")
      .field("id", def("Identifier"))
      .field("typeParameters", or(def("TypeParameterInstantiation"), null));

    def("TypeAlias")
      .bases("Declaration")
      .build("id", "typeParameters", "right")
      .field("id", def("Identifier"))
      .field("typeParameters", or(def("TypeParameterDeclaration"), null))
      .field("right", def("Type"));

    def("DeclareTypeAlias")
      .bases("TypeAlias")
      .build("id", "typeParameters", "right");

    def("TypeCastExpression")
      .bases("Expression")
      .build("expression", "typeAnnotation")
      .field("expression", def("Expression"))
      .field("typeAnnotation", def("TypeAnnotation"));

    def("TupleTypeAnnotation")
      .bases("Type")
      .build("types")
      .field("types", [def("Type")]);

    def("DeclareVariable")
      .bases("Statement")
      .build("id")
      .field("id", def("Identifier"));

    def("DeclareFunction")
      .bases("Statement")
      .build("id")
      .field("id", def("Identifier"));

    def("DeclareClass")
      .bases("InterfaceDeclaration")
      .build("id");

    def("DeclareModule")
      .bases("Statement")
      .build("id", "body")
      .field("id", or(def("Identifier"), def("Literal")))
      .field("body", def("BlockStatement"));

    def("DeclareModuleExports")
      .bases("Statement")
      .build("typeAnnotation")
      .field("typeAnnotation", def("Type"));

    def("DeclareExportDeclaration")
      .bases("Declaration")
      .build("default", "declaration", "specifiers", "source")
      .field("default", Boolean)
      .field("declaration", or(
        def("DeclareVariable"),
        def("DeclareFunction"),
        def("DeclareClass"),
        def("Type"), // Implies default.
        null
      ))
      .field("specifiers", [or(
        def("ExportSpecifier"),
        def("ExportBatchSpecifier")
      )], defaults.emptyArray)
      .field("source", or(
        def("Literal"),
        null
      ), defaults["null"]);

    def("DeclareExportAllDeclaration")
      .bases("Declaration")
      .build("source")
      .field("source", or(
        def("Literal"),
        null
      ), defaults["null"]);
};

},{"../lib/shared":19,"../lib/types":20,"./es7":8}],11:[function(require,module,exports){
module.exports = function (fork) {
  fork.use(require("./es7"));

  var types = fork.use(require("../lib/types"));
  var def = types.Type.def;
  var or = types.Type.or;
  var defaults = fork.use(require("../lib/shared")).defaults;

  def("JSXAttribute")
    .bases("Node")
    .build("name", "value")
    .field("name", or(def("JSXIdentifier"), def("JSXNamespacedName")))
    .field("value", or(
      def("Literal"), // attr="value"
      def("JSXExpressionContainer"), // attr={value}
      null // attr= or just attr
    ), defaults["null"]);

  def("JSXIdentifier")
    .bases("Identifier")
    .build("name")
    .field("name", String);

  def("JSXNamespacedName")
    .bases("Node")
    .build("namespace", "name")
    .field("namespace", def("JSXIdentifier"))
    .field("name", def("JSXIdentifier"));

  def("JSXMemberExpression")
    .bases("MemberExpression")
    .build("object", "property")
    .field("object", or(def("JSXIdentifier"), def("JSXMemberExpression")))
    .field("property", def("JSXIdentifier"))
    .field("computed", Boolean, defaults.false);

  var JSXElementName = or(
    def("JSXIdentifier"),
    def("JSXNamespacedName"),
    def("JSXMemberExpression")
  );

  def("JSXSpreadAttribute")
    .bases("Node")
    .build("argument")
    .field("argument", def("Expression"));

  var JSXAttributes = [or(
    def("JSXAttribute"),
    def("JSXSpreadAttribute")
  )];

  def("JSXExpressionContainer")
    .bases("Expression")
    .build("expression")
    .field("expression", def("Expression"));

  def("JSXElement")
    .bases("Expression")
    .build("openingElement", "closingElement", "children")
    .field("openingElement", def("JSXOpeningElement"))
    .field("closingElement", or(def("JSXClosingElement"), null), defaults["null"])
    .field("children", [or(
      def("JSXElement"),
      def("JSXExpressionContainer"),
      def("JSXText"),
      def("Literal") // TODO Esprima should return JSXText instead.
    )], defaults.emptyArray)
    .field("name", JSXElementName, function () {
      // Little-known fact: the `this` object inside a default function
      // is none other than the partially-built object itself, and any
      // fields initialized directly from builder function arguments
      // (like openingElement, closingElement, and children) are
      // guaranteed to be available.
      return this.openingElement.name;
    }, true) // hidden from traversal
    .field("selfClosing", Boolean, function () {
      return this.openingElement.selfClosing;
    }, true) // hidden from traversal
    .field("attributes", JSXAttributes, function () {
      return this.openingElement.attributes;
    }, true); // hidden from traversal

  def("JSXOpeningElement")
    .bases("Node") // TODO Does this make sense? Can't really be an JSXElement.
    .build("name", "attributes", "selfClosing")
    .field("name", JSXElementName)
    .field("attributes", JSXAttributes, defaults.emptyArray)
    .field("selfClosing", Boolean, defaults["false"]);

  def("JSXClosingElement")
    .bases("Node") // TODO Same concern.
    .build("name")
    .field("name", JSXElementName);

  def("JSXText")
    .bases("Literal")
    .build("value")
    .field("value", String);

  def("JSXEmptyExpression").bases("Expression").build();

  // This PR has caused many people issues, but supporting it seems like a
  // good idea anyway: https://github.com/babel/babel/pull/4988
  def("JSXSpreadChild")
    .bases("Expression")
    .build("expression")
    .field("expression", def("Expression"));
};

},{"../lib/shared":19,"../lib/types":20,"./es7":8}],12:[function(require,module,exports){
module.exports = function (fork) {
    fork.use(require("./core"));
    var types = fork.use(require("../lib/types"));
    var def = types.Type.def;
    var or = types.Type.or;
    var shared = fork.use(require("../lib/shared"));
    var geq = shared.geq;
    var defaults = shared.defaults;

    def("Function")
        // SpiderMonkey allows expression closures: function(x) x+1
        .field("body", or(def("BlockStatement"), def("Expression")));

    def("ForInStatement")
        .build("left", "right", "body", "each")
        .field("each", Boolean, defaults["false"]);

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
};
},{"../lib/shared":19,"../lib/types":20,"./core":5}],13:[function(require,module,exports){
module.exports = function (defs) {
    var used = [];
    var usedResult = [];
    var fork = {};

    function use(plugin) {
        var idx = used.indexOf(plugin);
        if (idx === -1) {
            idx = used.length;
            used.push(plugin);
            usedResult[idx] = plugin(fork);
        }
        return usedResult[idx];
    }

    fork.use = use;

    var types = use(require('./lib/types'));

    defs.forEach(use);

    types.finalize();

    var exports = {
        Type: types.Type,
        builtInTypes: types.builtInTypes,
        namedTypes: types.namedTypes,
        builders: types.builders,
        defineMethod: types.defineMethod,
        getFieldNames: types.getFieldNames,
        getFieldValue: types.getFieldValue,
        eachField: types.eachField,
        someField: types.someField,
        getSupertypeNames: types.getSupertypeNames,
        astNodesAreEquivalent: use(require("./lib/equiv")),
        finalize: types.finalize,
        Path: use(require('./lib/path')),
        NodePath: use(require("./lib/node-path")),
        PathVisitor: use(require("./lib/path-visitor")),
        use: use
    };

    exports.visit = exports.PathVisitor.visit;

    return exports;
};
},{"./lib/equiv":14,"./lib/node-path":15,"./lib/path":17,"./lib/path-visitor":16,"./lib/types":20}],14:[function(require,module,exports){
module.exports = function (fork) {
    var types = fork.use(require('../lib/types'));
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

    astNodesAreEquivalent.assert = function (a, b) {
        var problemPath = [];
        if (!astNodesAreEquivalent(a, b, problemPath)) {
            if (problemPath.length === 0) {
                if (a !== b) {
                    throw new Error("Nodes must be equal");
                }
            } else {
                throw new Error(
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
                var problemPathTail = problemPath.pop();
                if (problemPathTail !== i) {
                    throw new Error("" + problemPathTail);
                }
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
                    var problemPathTail = problemPath.pop();
                    if (problemPathTail !== name) {
                        throw new Error("" + problemPathTail);
                    }
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
    
    return astNodesAreEquivalent;
};

},{"../lib/types":20}],15:[function(require,module,exports){
module.exports = function (fork) {
    var types = fork.use(require("./types"));
    var n = types.namedTypes;
    var b = types.builders;
    var isNumber = types.builtInTypes.number;
    var isArray = types.builtInTypes.array;
    var Path = fork.use(require("./path"));
    var Scope = fork.use(require("./scope"));

    function NodePath(value, parentPath, name) {
        if (!(this instanceof NodePath)) {
            throw new Error("NodePath constructor cannot be invoked without 'new'");
        }
        Path.call(this, value, parentPath, name);
    }

    var NPp = NodePath.prototype = Object.create(Path.prototype, {
        constructor: {
            value: NodePath,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });

    Object.defineProperties(NPp, {
        node: {
            get: function () {
                Object.defineProperty(this, "node", {
                    configurable: true, // Enable deletion.
                    value: this._computeNode()
                });

                return this.node;
            }
        },

        parent: {
            get: function () {
                Object.defineProperty(this, "parent", {
                    configurable: true, // Enable deletion.
                    value: this._computeParent()
                });

                return this.parent;
            }
        },

        scope: {
            get: function () {
                Object.defineProperty(this, "scope", {
                    configurable: true, // Enable deletion.
                    value: this._computeScope()
                });

                return this.scope;
            }
        }
    });

    NPp.replace = function () {
        delete this.node;
        delete this.parent;
        delete this.scope;
        return Path.prototype.replace.apply(this, arguments);
    };

    NPp.prune = function () {
        var remainingNodePath = this.parent;

        this.replace();

        return cleanUpNodesAfterPrune(remainingNodePath);
    };

    // The value of the first ancestor Path whose value is a Node.
    NPp._computeNode = function () {
        var value = this.value;
        if (n.Node.check(value)) {
            return value;
        }

        var pp = this.parentPath;
        return pp && pp.node || null;
    };

    // The first ancestor Path whose value is a Node distinct from this.node.
    NPp._computeParent = function () {
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
    NPp._computeScope = function () {
        var value = this.value;
        var pp = this.parentPath;
        var scope = pp && pp.scope;

        if (n.Node.check(value) &&
          Scope.isEstablishedBy(value)) {
            scope = new Scope(this, scope);
        }

        return scope || null;
    };

    NPp.getValueProperty = function (name) {
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
    NPp.needsParens = function (assumeExpressionContext) {
        var pp = this.parentPath;
        if (!pp) {
            return false;
        }

        var node = this.value;

        // Only expressions need parentheses.
        if (!n.Expression.check(node)) {
            return false;
        }

        // Identifiers never need parentheses.
        if (node.type === "Identifier") {
            return false;
        }

        while (!n.Node.check(pp.value)) {
            pp = pp.parentPath;
            if (!pp) {
                return false;
            }
        }

        var parent = pp.value;

        switch (node.type) {
            case "UnaryExpression":
            case "SpreadElement":
            case "SpreadProperty":
                return parent.type === "MemberExpression"
                  && this.name === "object"
                  && parent.object === node;

            case "BinaryExpression":
            case "LogicalExpression":
                switch (parent.type) {
                    case "CallExpression":
                        return this.name === "callee"
                          && parent.callee === node;

                    case "UnaryExpression":
                    case "SpreadElement":
                    case "SpreadProperty":
                        return true;

                    case "MemberExpression":
                        return this.name === "object"
                          && parent.object === node;

                    case "BinaryExpression":
                    case "LogicalExpression":
                        var po = parent.operator;
                        var pp = PRECEDENCE[po];
                        var no = node.operator;
                        var np = PRECEDENCE[no];

                        if (pp > np) {
                            return true;
                        }

                        if (pp === np && this.name === "right") {
                            if (parent.right !== node) {
                                throw new Error("Nodes must be equal");
                            }
                            return true;
                        }

                    default:
                        return false;
                }

            case "SequenceExpression":
                switch (parent.type) {
                    case "ForStatement":
                        // Although parentheses wouldn't hurt around sequence
                        // expressions in the head of for loops, traditional style
                        // dictates that e.g. i++, j++ should not be wrapped with
                        // parentheses.
                        return false;

                    case "ExpressionStatement":
                        return this.name !== "expression";

                    default:
                        // Otherwise err on the side of overparenthesization, adding
                        // explicit exceptions above if this proves overzealous.
                        return true;
                }

            case "YieldExpression":
                switch (parent.type) {
                    case "BinaryExpression":
                    case "LogicalExpression":
                    case "UnaryExpression":
                    case "SpreadElement":
                    case "SpreadProperty":
                    case "CallExpression":
                    case "MemberExpression":
                    case "NewExpression":
                    case "ConditionalExpression":
                    case "YieldExpression":
                        return true;

                    default:
                        return false;
                }

            case "Literal":
                return parent.type === "MemberExpression"
                  && isNumber.check(node.value)
                  && this.name === "object"
                  && parent.object === node;

            case "AssignmentExpression":
            case "ConditionalExpression":
                switch (parent.type) {
                    case "UnaryExpression":
                    case "SpreadElement":
                    case "SpreadProperty":
                    case "BinaryExpression":
                    case "LogicalExpression":
                        return true;

                    case "CallExpression":
                        return this.name === "callee"
                          && parent.callee === node;

                    case "ConditionalExpression":
                        return this.name === "test"
                          && parent.test === node;

                    case "MemberExpression":
                        return this.name === "object"
                          && parent.object === node;

                    default:
                        return false;
                }

            default:
                if (parent.type === "NewExpression" &&
                  this.name === "callee" &&
                  parent.callee === node) {
                    return containsCallExpression(node);
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
    ].forEach(function (tier, i) {
        tier.forEach(function (op) {
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
            return types.someField(node, function (name, child) {
                return containsCallExpression(child);
            });
        }

        return false;
    }

    NPp.canBeFirstInStatement = function () {
        var node = this.node;
        return !n.FunctionExpression.check(node)
          && !n.ObjectExpression.check(node);
    };

    NPp.firstInStatement = function () {
        return firstInStatement(this);
    };

    function firstInStatement(path) {
        for (var node, parent; path.parent; path = path.parent) {
            node = path.node;
            parent = path.parent.node;

            if (n.BlockStatement.check(parent) &&
              path.parent.name === "body" &&
              path.name === 0) {
                if (parent.body[0] !== node) {
                    throw new Error("Nodes must be equal");
                }
                return true;
            }

            if (n.ExpressionStatement.check(parent) &&
              path.name === "expression") {
                if (parent.expression !== node) {
                    throw new Error("Nodes must be equal");
                }
                return true;
            }

            if (n.SequenceExpression.check(parent) &&
              path.parent.name === "expressions" &&
              path.name === 0) {
                if (parent.expressions[0] !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }

            if (n.CallExpression.check(parent) &&
              path.name === "callee") {
                if (parent.callee !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }

            if (n.MemberExpression.check(parent) &&
              path.name === "object") {
                if (parent.object !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }

            if (n.ConditionalExpression.check(parent) &&
              path.name === "test") {
                if (parent.test !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }

            if (isBinary(parent) &&
              path.name === "left") {
                if (parent.left !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }

            if (n.UnaryExpression.check(parent) &&
              !parent.prefix &&
              path.name === "argument") {
                if (parent.argument !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }

            return false;
        }

        return true;
    }

    /**
     * Pruning certain nodes will result in empty or incomplete nodes, here we clean those nodes up.
     */
    function cleanUpNodesAfterPrune(remainingNodePath) {
        if (n.VariableDeclaration.check(remainingNodePath.node)) {
            var declarations = remainingNodePath.get('declarations').value;
            if (!declarations || declarations.length === 0) {
                return remainingNodePath.prune();
            }
        } else if (n.ExpressionStatement.check(remainingNodePath.node)) {
            if (!remainingNodePath.get('expression').value) {
                return remainingNodePath.prune();
            }
        } else if (n.IfStatement.check(remainingNodePath.node)) {
            cleanUpIfStatementAfterPrune(remainingNodePath);
        }

        return remainingNodePath;
    }

    function cleanUpIfStatementAfterPrune(ifStatement) {
        var testExpression = ifStatement.get('test').value;
        var alternate = ifStatement.get('alternate').value;
        var consequent = ifStatement.get('consequent').value;

        if (!consequent && !alternate) {
            var testExpressionStatement = b.expressionStatement(testExpression);

            ifStatement.replace(testExpressionStatement);
        } else if (!consequent && alternate) {
            var negatedTestExpression = b.unaryExpression('!', testExpression, true);

            if (n.UnaryExpression.check(testExpression) && testExpression.operator === '!') {
                negatedTestExpression = testExpression.argument;
            }

            ifStatement.get("test").replace(negatedTestExpression);
            ifStatement.get("consequent").replace(alternate);
            ifStatement.get("alternate").replace();
        }
    }

    return NodePath;
};

},{"./path":17,"./scope":18,"./types":20}],16:[function(require,module,exports){
var hasOwn = Object.prototype.hasOwnProperty;

module.exports = function (fork) {
    var types = fork.use(require("./types"));
    var NodePath = fork.use(require("./node-path"));
    var Printable = types.namedTypes.Printable;
    var isArray = types.builtInTypes.array;
    var isObject = types.builtInTypes.object;
    var isFunction = types.builtInTypes.function;
    var undefined;

    function PathVisitor() {
        if (!(this instanceof PathVisitor)) {
            throw new Error(
              "PathVisitor constructor cannot be invoked without 'new'"
            );
        }

        // Permanent state.
        this._reusableContextStack = [];

        this._methodNameTable = computeMethodNameTable(this);
        this._shouldVisitComments =
          hasOwn.call(this._methodNameTable, "Block") ||
          hasOwn.call(this._methodNameTable, "Line");

        this.Context = makeContextConstructor(this);

        // State reset every time PathVisitor.prototype.visit is called.
        this._visiting = false;
        this._changeReported = false;
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

        var typeNames = Object.keys(supertypeTable);
        var typeNameCount = typeNames.length;
        for (var i = 0; i < typeNameCount; ++i) {
            var typeName = typeNames[i];
            methodName = "visit" + supertypeTable[typeName];
            if (isFunction.check(visitor[methodName])) {
                methodNameTable[typeName] = methodName;
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
            if (!(this instanceof Visitor)) {
                throw new Error(
                  "Visitor constructor cannot be invoked without 'new'"
                );
            }
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
        return PathVisitor.fromMethodsObject(methods).visit(node);
    };

    var PVp = PathVisitor.prototype;

    PVp.visit = function () {
        if (this._visiting) {
            throw new Error(
              "Recursively calling visitor.visit(path) resets visitor state. " +
              "Try this.visit(path) or this.traverse(path) instead."
            );
        }

        // Private state that needs to be reset before every traversal.
        this._visiting = true;
        this._changeReported = false;
        this._abortRequested = false;

        var argc = arguments.length;
        var args = new Array(argc)
        for (var i = 0; i < argc; ++i) {
            args[i] = arguments[i];
        }

        if (!(args[0] instanceof NodePath)) {
            args[0] = new NodePath({root: args[0]}).get("root");
        }

        // Called with the same arguments as .visit.
        this.reset.apply(this, args);

        try {
            var root = this.visitWithoutReset(args[0]);
            var didNotThrow = true;
        } finally {
            this._visiting = false;

            if (!didNotThrow && this._abortRequested) {
                // If this.visitWithoutReset threw an exception and
                // this._abortRequested was set to true, return the root of
                // the AST instead of letting the exception propagate, so that
                // client code does not have to provide a try-catch block to
                // intercept the AbortRequest exception.  Other kinds of
                // exceptions will propagate without being intercepted and
                // rethrown by a catch block, so their stacks will accurately
                // reflect the original throwing context.
                return args[0].value;
            }
        }

        return root;
    };

    PVp.AbortRequest = function AbortRequest() {};
    PVp.abort = function () {
        var visitor = this;
        visitor._abortRequested = true;
        var request = new visitor.AbortRequest();

        // If you decide to catch this exception and stop it from propagating,
        // make sure to call its cancel method to avoid silencing other
        // exceptions that might be thrown later in the traversal.
        request.cancel = function () {
            visitor._abortRequested = false;
        };

        throw request;
    };

    PVp.reset = function (path/*, additional arguments */) {
        // Empty stub; may be reassigned or overridden by subclasses.
    };

    PVp.visitWithoutReset = function (path) {
        if (this instanceof this.Context) {
            // Since this.Context.prototype === this, there's a chance we
            // might accidentally call context.visitWithoutReset. If that
            // happens, re-invoke the method against context.visitor.
            return this.visitor.visitWithoutReset(path);
        }

        if (!(path instanceof NodePath)) {
            throw new Error("");
        }

        var value = path.value;

        var methodName = value &&
          typeof value === "object" &&
          typeof value.type === "string" &&
          this._methodNameTable[value.type];

        if (methodName) {
            var context = this.acquireContext(path);
            try {
                return context.invokeVisitorMethod(methodName);
            } finally {
                this.releaseContext(context);
            }

        } else {
            // If there was no visitor method to call, visit the children of
            // this node generically.
            return visitChildren(path, this);
        }
    };

    function visitChildren(path, visitor) {
        if (!(path instanceof NodePath)) {
            throw new Error("");
        }
        if (!(visitor instanceof PathVisitor)) {
            throw new Error("");
        }

        var value = path.value;

        if (isArray.check(value)) {
            path.each(visitor.visitWithoutReset, visitor);
        } else if (!isObject.check(value)) {
            // No children to visit.
        } else {
            var childNames = types.getFieldNames(value);

            // The .comments field of the Node type is hidden, so we only
            // visit it if the visitor defines visitBlock or visitLine, and
            // value.comments is defined.
            if (visitor._shouldVisitComments &&
              value.comments &&
              childNames.indexOf("comments") < 0) {
                childNames.push("comments");
            }

            var childCount = childNames.length;
            var childPaths = [];

            for (var i = 0; i < childCount; ++i) {
                var childName = childNames[i];
                if (!hasOwn.call(value, childName)) {
                    value[childName] = types.getFieldValue(value, childName);
                }
                childPaths.push(path.get(childName));
            }

            for (var i = 0; i < childCount; ++i) {
                visitor.visitWithoutReset(childPaths[i]);
            }
        }

        return path.value;
    }

    PVp.acquireContext = function (path) {
        if (this._reusableContextStack.length === 0) {
            return new this.Context(path);
        }
        return this._reusableContextStack.pop().reset(path);
    };

    PVp.releaseContext = function (context) {
        if (!(context instanceof this.Context)) {
            throw new Error("");
        }
        this._reusableContextStack.push(context);
        context.currentPath = null;
    };

    PVp.reportChanged = function () {
        this._changeReported = true;
    };

    PVp.wasChangeReported = function () {
        return this._changeReported;
    };

    function makeContextConstructor(visitor) {
        function Context(path) {
            if (!(this instanceof Context)) {
                throw new Error("");
            }
            if (!(this instanceof PathVisitor)) {
                throw new Error("");
            }
            if (!(path instanceof NodePath)) {
                throw new Error("");
            }

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

        if (!(visitor instanceof PathVisitor)) {
            throw new Error("");
        }

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
          if (!(this instanceof this.Context)) {
              throw new Error("");
          }
          if (!(path instanceof NodePath)) {
              throw new Error("");
          }

          this.currentPath = path;
          this.needToCallTraverse = true;

          return this;
      };

    sharedContextProtoMethods.invokeVisitorMethod =
      function invokeVisitorMethod(methodName) {
          if (!(this instanceof this.Context)) {
              throw new Error("");
          }
          if (!(this.currentPath instanceof NodePath)) {
              throw new Error("");
          }

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

          if (this.needToCallTraverse !== false) {
              throw new Error(
                "Must either call this.traverse or return false in " + methodName
              );
          }

          var path = this.currentPath;
          return path && path.value;
      };

    sharedContextProtoMethods.traverse =
      function traverse(path, newVisitor) {
          if (!(this instanceof this.Context)) {
              throw new Error("");
          }
          if (!(path instanceof NodePath)) {
              throw new Error("");
          }
          if (!(this.currentPath instanceof NodePath)) {
              throw new Error("");
          }

          this.needToCallTraverse = false;

          return visitChildren(path, PathVisitor.fromMethodsObject(
            newVisitor || this.visitor
          ));
      };

    sharedContextProtoMethods.visit =
      function visit(path, newVisitor) {
          if (!(this instanceof this.Context)) {
              throw new Error("");
          }
          if (!(path instanceof NodePath)) {
              throw new Error("");
          }
          if (!(this.currentPath instanceof NodePath)) {
              throw new Error("");
          }

          this.needToCallTraverse = false;

          return PathVisitor.fromMethodsObject(
            newVisitor || this.visitor
          ).visitWithoutReset(path);
      };

    sharedContextProtoMethods.reportChanged = function reportChanged() {
        this.visitor.reportChanged();
    };

    sharedContextProtoMethods.abort = function abort() {
        this.needToCallTraverse = false;
        this.visitor.abort();
    };

    return PathVisitor;
};

},{"./node-path":15,"./types":20}],17:[function(require,module,exports){
var Ap = Array.prototype;
var slice = Ap.slice;
var map = Ap.map;
var Op = Object.prototype;
var hasOwn = Op.hasOwnProperty;

module.exports = function (fork) {
    var types = fork.use(require("./types"));
    var isArray = types.builtInTypes.array;
    var isNumber = types.builtInTypes.number;

    function Path(value, parentPath, name) {
        if (!(this instanceof Path)) {
            throw new Error("Path constructor cannot be invoked without 'new'");
        }

        if (parentPath) {
            if (!(parentPath instanceof Path)) {
                throw new Error("");
            }
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

        this.each(function (childPath) {
            result.push(callback.call(this, childPath));
        }, context);

        return result;
    };

    Pp.filter = function filter(callback, context) {
        var result = [];

        this.each(function (childPath) {
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
                if (childPath.name !== i) {
                    throw new Error("");
                }
                var newIndex = i + offset;
                childPath.name = newIndex;
                moves[newIndex] = childPath;
                delete cache[i];
            }
        }

        delete cache.length;

        return function () {
            for (var newIndex in moves) {
                var childPath = moves[newIndex];
                if (childPath.name !== +newIndex) {
                    throw new Error("");
                }
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
        if (!(path instanceof Path)) {
            throw new Error("");
        }

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

        if (parentValue[path.name] !== path.value) {
            throw new Error("");
        }
        if (path.parentPath.get(path.name) !== path) {
            throw new Error("");
        }

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
            for (var i = 0; i < count; ++i) {
                spliceArgs.push(arguments[i]);
            }

            var splicedOut = parentValue.splice.apply(parentValue, spliceArgs);

            if (splicedOut[0] !== this.value) {
                throw new Error("");
            }
            if (parentValue.length !== (originalLength - 1 + count)) {
                throw new Error("");
            }

            move();

            if (count === 0) {
                delete this.value;
                delete parentCache[this.name];
                this.__childCache = null;

            } else {
                if (parentValue[this.name] !== replacement) {
                    throw new Error("");
                }

                if (this.value !== replacement) {
                    this.value = replacement;
                    this.__childCache = null;
                }

                for (i = 0; i < count; ++i) {
                    results.push(this.parentPath.get(this.name + i));
                }

                if (results[0] !== this) {
                    throw new Error("");
                }
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
            throw new Error("Could not replace path");
        }

        return results;
    };

    return Path;
};

},{"./types":20}],18:[function(require,module,exports){
var hasOwn = Object.prototype.hasOwnProperty;

module.exports = function (fork) {
    var types = fork.use(require("./types"));
    var Type = types.Type;
    var namedTypes = types.namedTypes;
    var Node = namedTypes.Node;
    var Expression = namedTypes.Expression;
    var isArray = types.builtInTypes.array;
    var b = types.builders;

    function Scope(path, parentScope) {
        if (!(this instanceof Scope)) {
            throw new Error("Scope constructor cannot be invoked without 'new'");
        }
        if (!(path instanceof fork.use(require("./node-path")))) {
            throw new Error("");
        }
        ScopeType.assert(path.value);

        var depth;

        if (parentScope) {
            if (!(parentScope instanceof Scope)) {
                throw new Error("");
            }
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
            bindings: { value: {} },
            types: { value: {} },
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

    Sp.declaresType = function(name) {
        this.scan();
        return hasOwn.call(this.types, name);
    };

    Sp.declareTemporary = function(prefix) {
        if (prefix) {
            if (!/^[a-z$_]/i.test(prefix)) {
                throw new Error("");
            }
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
            scanScope(this.path, this.bindings, this.types);
            this.didScan = true;
        }
    };

    Sp.getBindings = function () {
        this.scan();
        return this.bindings;
    };

    Sp.getTypes = function () {
        this.scan();
        return this.types;
    };

    function scanScope(path, bindings, scopeTypes) {
        var node = path.value;
        ScopeType.assert(node);

        if (namedTypes.CatchClause.check(node)) {
            // A catch clause establishes a new scope but the only variable
            // bound in that scope is the catch parameter. Any other
            // declarations create bindings in the outer scope.
            addPattern(path.get("param"), bindings);

        } else {
            recursiveScanScope(path, bindings, scopeTypes);
        }
    }

    function recursiveScanScope(path, bindings, scopeTypes) {
        var node = path.value;

        if (path.parent &&
          namedTypes.FunctionExpression.check(path.parent.node) &&
          path.parent.node.id) {
            addPattern(path.parent.get("id"), bindings);
        }

        if (!node) {
            // None of the remaining cases matter if node is falsy.

        } else if (isArray.check(node)) {
            path.each(function(childPath) {
                recursiveScanChild(childPath, bindings, scopeTypes);
            });

        } else if (namedTypes.Function.check(node)) {
            path.get("params").each(function(paramPath) {
                addPattern(paramPath, bindings);
            });

            recursiveScanChild(path.get("body"), bindings, scopeTypes);

        } else if (namedTypes.TypeAlias && namedTypes.TypeAlias.check(node)) {
            addTypePattern(path.get("id"), scopeTypes);

        } else if (namedTypes.VariableDeclarator.check(node)) {
            addPattern(path.get("id"), bindings);
            recursiveScanChild(path.get("init"), bindings, scopeTypes);

        } else if (node.type === "ImportSpecifier" ||
          node.type === "ImportNamespaceSpecifier" ||
          node.type === "ImportDefaultSpecifier") {
            addPattern(
              // Esprima used to use the .name field to refer to the local
              // binding identifier for ImportSpecifier nodes, but .id for
              // ImportNamespaceSpecifier and ImportDefaultSpecifier nodes.
              // ESTree/Acorn/ESpree use .local for all three node types.
              path.get(node.local ? "local" :
                node.name ? "name" : "id"),
              bindings
            );

        } else if (Node.check(node) && !Expression.check(node)) {
            types.eachField(node, function(name, child) {
                var childPath = path.get(name);
                if (!pathHasValue(childPath, child)) {
                    throw new Error("");
                }
                recursiveScanChild(childPath, bindings, scopeTypes);
            });
        }
    }

    function pathHasValue(path, value) {
        if (path.value === value) {
            return true;
        }

        // Empty arrays are probably produced by defaults.emptyArray, in which
        // case is makes sense to regard them as equivalent, if not ===.
        if (Array.isArray(path.value) &&
          path.value.length === 0 &&
          Array.isArray(value) &&
          value.length === 0) {
            return true;
        }

        return false;
    }

    function recursiveScanChild(path, bindings, scopeTypes) {
        var node = path.value;

        if (!node || Expression.check(node)) {
            // Ignore falsy values and Expressions.

        } else if (namedTypes.FunctionDeclaration.check(node) &&
                   node.id !== null) {
            addPattern(path.get("id"), bindings);

        } else if (namedTypes.ClassDeclaration &&
          namedTypes.ClassDeclaration.check(node)) {
            addPattern(path.get("id"), bindings);

        } else if (ScopeType.check(node)) {
            if (namedTypes.CatchClause.check(node)) {
                var catchParamName = node.param.name;
                var hadBinding = hasOwn.call(bindings, catchParamName);

                // Any declarations that occur inside the catch body that do
                // not have the same name as the catch parameter should count
                // as bindings in the outer scope.
                recursiveScanScope(path.get("body"), bindings, scopeTypes);

                // If a new binding matching the catch parameter name was
                // created while scanning the catch body, ignore it because it
                // actually refers to the catch parameter and not the outer
                // scope that we're currently scanning.
                if (!hadBinding) {
                    delete bindings[catchParamName];
                }
            }

        } else {
            recursiveScanScope(path, bindings, scopeTypes);
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

        } else if (namedTypes.ObjectPattern &&
          namedTypes.ObjectPattern.check(pattern)) {
            patternPath.get('properties').each(function(propertyPath) {
                var property = propertyPath.value;
                if (namedTypes.Pattern.check(property)) {
                    addPattern(propertyPath, bindings);
                } else  if (namedTypes.Property.check(property)) {
                    addPattern(propertyPath.get('value'), bindings);
                } else if (namedTypes.SpreadProperty &&
                  namedTypes.SpreadProperty.check(property)) {
                    addPattern(propertyPath.get('argument'), bindings);
                }
            });

        } else if (namedTypes.ArrayPattern &&
          namedTypes.ArrayPattern.check(pattern)) {
            patternPath.get('elements').each(function(elementPath) {
                var element = elementPath.value;
                if (namedTypes.Pattern.check(element)) {
                    addPattern(elementPath, bindings);
                } else if (namedTypes.SpreadElement &&
                  namedTypes.SpreadElement.check(element)) {
                    addPattern(elementPath.get("argument"), bindings);
                }
            });

        } else if (namedTypes.PropertyPattern &&
          namedTypes.PropertyPattern.check(pattern)) {
            addPattern(patternPath.get('pattern'), bindings);

        } else if ((namedTypes.SpreadElementPattern &&
          namedTypes.SpreadElementPattern.check(pattern)) ||
          (namedTypes.SpreadPropertyPattern &&
          namedTypes.SpreadPropertyPattern.check(pattern))) {
            addPattern(patternPath.get('argument'), bindings);
        }
    }

    function addTypePattern(patternPath, types) {
        var pattern = patternPath.value;
        namedTypes.Pattern.assert(pattern);

        if (namedTypes.Identifier.check(pattern)) {
            if (hasOwn.call(types, pattern.name)) {
                types[pattern.name].push(patternPath);
            } else {
                types[pattern.name] = [patternPath];
            }

        }
    }

    Sp.lookup = function(name) {
        for (var scope = this; scope; scope = scope.parent)
            if (scope.declares(name))
                break;
        return scope;
    };

    Sp.lookupType = function(name) {
        for (var scope = this; scope; scope = scope.parent)
            if (scope.declaresType(name))
                break;
        return scope;
    };

    Sp.getGlobalScope = function() {
        var scope = this;
        while (!scope.isGlobal)
            scope = scope.parent;
        return scope;
    };

    return Scope;
};

},{"./node-path":15,"./types":20}],19:[function(require,module,exports){
module.exports = function (fork) {
    var exports = {};
    var types = fork.use(require("../lib/types"));
    var Type = types.Type;
    var builtin = types.builtInTypes;
    var isNumber = builtin.number;

    // An example of constructing a new type with arbitrary constraints from
    // an existing type.
    exports.geq = function (than) {
        return new Type(function (value) {
            return isNumber.check(value) && value >= than;
        }, isNumber + " >= " + than);
    };

    // Default value-returning functions that may optionally be passed as a
    // third argument to Def.prototype.field.
    exports.defaults = {
        // Functions were used because (among other reasons) that's the most
        // elegant way to allow for the emptyArray one always to give a new
        // array instance.
        "null": function () { return null },
        "emptyArray": function () { return [] },
        "false": function () { return false },
        "true": function () { return true },
        "undefined": function () {}
    };

    var naiveIsPrimitive = Type.or(
      builtin.string,
      builtin.number,
      builtin.boolean,
      builtin.null,
      builtin.undefined
    );

    exports.isPrimitive = new Type(function (value) {
        if (value === null)
            return true;
        var type = typeof value;
        return !(type === "object" ||
        type === "function");
    }, naiveIsPrimitive.toString());

    return exports;
};
},{"../lib/types":20}],20:[function(require,module,exports){
var Ap = Array.prototype;
var slice = Ap.slice;
var map = Ap.map;
var each = Ap.forEach;
var Op = Object.prototype;
var objToStr = Op.toString;
var funObjStr = objToStr.call(function(){});
var strObjStr = objToStr.call("");
var hasOwn = Op.hasOwnProperty;

module.exports = function () {

    var exports = {};

    // A type is an object with a .check method that takes a value and returns
    // true or false according to whether the value matches the type.

    function Type(check, name) {
        var self = this;
        if (!(self instanceof Type)) {
            throw new Error("Type constructor cannot be invoked without 'new'");
        }

        // Unfortunately we can't elegantly reuse isFunction and isString,
        // here, because this code is executed while defining those types.
        if (objToStr.call(check) !== funObjStr) {
            throw new Error(check + " is not a function");
        }

        // The `name` parameter can be either a function or a string.
        var nameObjStr = objToStr.call(name);
        if (!(nameObjStr === funObjStr ||
          nameObjStr === strObjStr)) {
            throw new Error(name + " is neither a function nor a string");
        }

        Object.defineProperties(self, {
            name: {value: name},
            check: {
                value: function (value, deep) {
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
    Tp.assert = function (value, deep) {
        if (!this.check(value, deep)) {
            var str = shallowStringify(value);
            throw new Error(str + " does not match type " + this);
        }
        return true;
    };

    function shallowStringify(value) {
        if (isObject.check(value))
            return "{" + Object.keys(value).map(function (key) {
                  return key + ": " + value[key];
              }).join(", ") + "}";

        if (isArray.check(value))
            return "[" + value.map(shallowStringify).join(", ") + "]";

        return JSON.stringify(value);
    }

    Tp.toString = function () {
        var name = this.name;

        if (isString.check(name))
            return name;

        if (isFunction.check(name))
            return name.call(this) + "";

        return name + " type";
    };

    var builtInCtorFns = [];
    var builtInCtorTypes = [];
    var builtInTypes = {};
    exports.builtInTypes = builtInTypes;

    function defBuiltInType(example, name) {
        var objStr = objToStr.call(example);

        var type = new Type(function (value) {
            return objToStr.call(value) === objStr;
        }, name);

        builtInTypes[name] = type;

        if (example && typeof example.constructor === "function") {
            builtInCtorFns.push(example.constructor);
            builtInCtorTypes.push(type);
        }

        return type;
    }

    // These types check the underlying [[Class]] attribute of the given
    // value, rather than using the problematic typeof operator. Note however
    // that no subtyping is considered; so, for instance, isObject.check
    // returns false for [], /./, new Date, and null.
    var isString = defBuiltInType("truthy", "string");
    var isFunction = defBuiltInType(function () {}, "function");
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

        if (isFunction.check(from)) {
            var bicfIndex = builtInCtorFns.indexOf(from);
            if (bicfIndex >= 0) {
                return builtInCtorTypes[bicfIndex];
            }

            // If isFunction.check(from), and from is not a built-in
            // constructor, assume from is a binary predicate function we can
            // use to define the type.
            return new Type(from, name);
        }

        // As a last resort, toType returns a type that matches any value that
        // is === from. This is primarily useful for literal values like
        // toType(null), but it has the additional advantage of allowing
        // toType to be a total function.
        return new Type(function (value) {
            return value === from;
        }, isUndefined.check(name) ? function () {
            return from + "";
        } : name);
    }

    // Returns a type that matches the given value iff any of type1, type2,
    // etc. match the value.
    Type.or = function (/* type1, type2, ... */) {
        var types = [];
        var len = arguments.length;
        for (var i = 0; i < len; ++i)
            types.push(toType(arguments[i]));

        return new Type(function (value, deep) {
            for (var i = 0; i < len; ++i)
                if (types[i].check(value, deep))
                    return true;
            return false;
        }, function () {
            return types.join(" | ");
        });
    };

    Type.fromArray = function (arr) {
        if (!isArray.check(arr)) {
            throw new Error("");
        }
        if (arr.length !== 1) {
            throw new Error("only one element type is permitted for typed arrays");
        }
        return toType(arr[0]).arrayOf();
    };

    Tp.arrayOf = function () {
        var elemType = this;
        return new Type(function (value, deep) {
            return isArray.check(value) && value.every(function (elem) {
                  return elemType.check(elem, deep);
              });
        }, function () {
            return "[" + elemType + "]";
        });
    };

    Type.fromObject = function (obj) {
        var fields = Object.keys(obj).map(function (name) {
            return new Field(name, obj[name]);
        });

        return new Type(function (value, deep) {
            return isObject.check(value) && fields.every(function (field) {
                  return field.type.check(value[field.name], deep);
              });
        }, function () {
            return "{ " + fields.join(", ") + " }";
        });
    };

    function Field(name, type, defaultFn, hidden) {
        var self = this;

        if (!(self instanceof Field)) {
            throw new Error("Field constructor cannot be invoked without 'new'");
        }
        isString.assert(name);

        type = toType(type);

        var properties = {
            name: {value: name},
            type: {value: type},
            hidden: {value: !!hidden}
        };

        if (isFunction.check(defaultFn)) {
            properties.defaultFn = {value: defaultFn};
        }

        Object.defineProperties(self, properties);
    }

    var Fp = Field.prototype;

    Fp.toString = function () {
        return JSON.stringify(this.name) + ": " + this.type;
    };

    Fp.getValue = function (obj) {
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
    Type.def = function (typeName) {
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
        if (!(self instanceof Def)) {
            throw new Error("Def constructor cannot be invoked without 'new'");
        }

        Object.defineProperties(self, {
            typeName: {value: typeName},
            baseNames: {value: []},
            ownFields: {value: Object.create(null)},

            // These two are populated during finalization.
            allSupertypes: {value: Object.create(null)}, // Includes own typeName.
            supertypeList: {value: []}, // Linear inheritance hierarchy.
            allFields: {value: Object.create(null)}, // Includes inherited fields.
            fieldNames: {value: []}, // Non-hidden keys of allFields.

            type: {
                value: new Type(function (value, deep) {
                    return self.check(value, deep);
                }, typeName)
            }
        });
    }

    Def.fromValue = function (value) {
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

    Dp.isSupertypeOf = function (that) {
        if (that instanceof Def) {
            if (this.finalized !== true ||
              that.finalized !== true) {
                throw new Error("");
            }
            return hasOwn.call(that.allSupertypes, this.typeName);
        } else {
            throw new Error(that + " is not a Def");
        }
    };

    // Note that the list returned by this function is a copy of the internal
    // supertypeList, *without* the typeName itself as the first element.
    exports.getSupertypeNames = function (typeName) {
        if (!hasOwn.call(defCache, typeName)) {
            throw new Error("");
        }
        var d = defCache[typeName];
        if (d.finalized !== true) {
            throw new Error("");
        }
        return d.supertypeList.slice(1);
    };

    // Returns an object mapping from every known type in the defCache to the
    // most specific supertype whose name is an own property of the candidates
    // object.
    exports.computeSupertypeLookupTable = function (candidates) {
        var table = {};
        var typeNames = Object.keys(defCache);
        var typeNameCount = typeNames.length;

        for (var i = 0; i < typeNameCount; ++i) {
            var typeName = typeNames[i];
            var d = defCache[typeName];
            if (d.finalized !== true) {
                throw new Error("" + typeName);
            }
            for (var j = 0; j < d.supertypeList.length; ++j) {
                var superTypeName = d.supertypeList[j];
                if (hasOwn.call(candidates, superTypeName)) {
                    table[typeName] = superTypeName;
                    break;
                }
            }
        }

        return table;
    };

    Dp.checkAllFields = function (value, deep) {
        var allFields = this.allFields;
        if (this.finalized !== true) {
            throw new Error("" + this.typeName);
        }

        function checkFieldByName(name) {
            var field = allFields[name];
            var type = field.type;
            var child = field.getValue(value);
            return type.check(child, deep);
        }

        return isObject.check(value)
          && Object.keys(allFields).every(checkFieldByName);
    };

    Dp.check = function (value, deep) {
        if (this.finalized !== true) {
            throw new Error(
              "prematurely checking unfinalized type " + this.typeName
            );
        }

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

    Dp.bases = function () {
        var args = slice.call(arguments);
        var bases = this.baseNames;

        if (this.finalized) {
            if (args.length !== bases.length) {
                throw new Error("");
            }
            for (var i = 0; i < args.length; i++) {
                if (args[i] !== bases[i]) {
                    throw new Error("");
                }
            }
            return this;
        }

        args.forEach(function (baseName) {
            isString.assert(baseName);

            // This indexOf lookup may be O(n), but the typical number of base
            // names is very small, and indexOf is a native Array method.
            if (bases.indexOf(baseName) < 0)
                bases.push(baseName);
        });

        return this; // For chaining.
    };

    // False by default until .build(...) is called on an instance.
    Object.defineProperty(Dp, "buildable", {value: false});

    var builders = {};
    exports.builders = builders;

    // This object is used as prototype for any node created by a builder.
    var nodePrototype = {};

    // Call this function to define a new method to be shared by all AST
     // nodes. The replaced method (if any) is returned for easy wrapping.
    exports.defineMethod = function (name, func) {
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

    var isArrayOfString = isString.arrayOf();

    // Calling the .build method of a Def simultaneously marks the type as
    // buildable (by defining builders[getBuilderName(typeName)]) and
    // specifies the order of arguments that should be passed to the builder
    // function to create an instance of the type.
    Dp.build = function (/* param1, param2, ... */) {
        var self = this;

        var newBuildParams = slice.call(arguments);
        isArrayOfString.assert(newBuildParams);

        // Calling Def.prototype.build multiple times has the effect of merely
        // redefining this property.
        Object.defineProperty(self, "buildParams", {
            value: newBuildParams,
            writable: false,
            enumerable: false,
            configurable: true
        });

        if (self.buildable) {
            // If this Def is already buildable, update self.buildParams and
            // continue using the old builder function.
            return self;
        }

        // Every buildable type will have its "type" field filled in
        // automatically. This includes types that are not subtypes of Node,
        // like SourceLocation, but that seems harmless (TODO?).
        self.field("type", String, function () { return self.typeName });

        // Override Dp.buildable for this Def instance.
        Object.defineProperty(self, "buildable", {value: true});

        Object.defineProperty(builders, getBuilderName(self.typeName), {
            enumerable: true,

            value: function () {
                var args = arguments;
                var argc = args.length;
                var built = Object.create(nodePrototype);

                if (!self.finalized) {
                    throw new Error(
                      "attempting to instantiate unfinalized type " +
                      self.typeName
                    );
                }

                function add(param, i) {
                    if (hasOwn.call(built, param))
                        return;

                    var all = self.allFields;
                    if (!hasOwn.call(all, param)) {
                        throw new Error("" + param);
                    }

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
                          self.buildParams.map(function (name) {
                              return all[name];
                          }).join(", ") + ")";
                        throw new Error(message);
                    }

                    if (!type.check(value)) {
                        throw new Error(
                          shallowStringify(value) +
                          " does not match field " + field +
                          " of type " + self.typeName
                        );
                    }

                    // TODO Could attach getters and setters here to enforce
                    // dynamic type safety.
                    built[param] = value;
                }

                self.buildParams.forEach(function (param, i) {
                    add(param, i);
                });

                Object.keys(self.allFields).forEach(function (param) {
                    add(param); // Use the default value.
                });

                // Make sure that the "type" field was filled automatically.
                if (built.type !== self.typeName) {
                    throw new Error("");
                }

                return built;
            }
        });

        return self; // For chaining.
    };

    function getBuilderName(typeName) {
        return typeName.replace(/^[A-Z]+/, function (upperCasePrefix) {
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
    exports.getBuilderName = getBuilderName;

    function getStatementBuilderName(typeName) {
        typeName = getBuilderName(typeName);
        return typeName.replace(/(Expression)?$/, "Statement");
    }
    exports.getStatementBuilderName = getStatementBuilderName;

    // The reason fields are specified using .field(...) instead of an object
    // literal syntax is somewhat subtle: the object literal syntax would
    // support only one key and one value, but with .field(...) we can pass
    // any number of arguments to specify the field.
    Dp.field = function (name, type, defaultFn, hidden) {
        if (this.finalized) {
            console.error("Ignoring attempt to redefine field " +
              JSON.stringify(name) + " of finalized type " +
              JSON.stringify(this.typeName));
            return this;
        }
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

        if ("type" in object) {
            throw new Error(
              "did not recognize object of type " +
              JSON.stringify(object.type)
            );
        }

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

        return object && object[fieldName];
    }
    exports.getFieldValue = getFieldValue;

    // Iterate over all defined fields of an object, including those missing
    // or undefined, passing each field name and effective value (as returned
    // by getFieldValue) to the callback. If the object has no corresponding
    // Def, the callback will never be called.
    exports.eachField = function (object, callback, context) {
        getFieldNames(object).forEach(function (name) {
            callback.call(this, name, getFieldValue(object, name));
        }, context);
    };

    // Similar to eachField, except that iteration stops as soon as the
    // callback returns a truthy value. Like Array.prototype.some, the final
    // result is either true or false to indicates whether the callback
    // returned true for any element or not.
    exports.someField = function (object, callback, context) {
        return getFieldNames(object).some(function (name) {
            return callback.call(this, name, getFieldValue(object, name));
        }, context);
    };

    // This property will be overridden as true by individual Def instances
    // when they are finalized.
    Object.defineProperty(Dp, "finalized", {value: false});

    Dp.finalize = function () {
        var self = this;

        // It's not an error to finalize a type more than once, but only the
        // first call to .finalize does anything.
        if (!self.finalized) {
            var allFields = self.allFields;
            var allSupertypes = self.allSupertypes;

            self.baseNames.forEach(function (name) {
                var def = defCache[name];
                if (def instanceof Def) {
                    def.finalize();
                    extend(allFields, def.allFields);
                    extend(allSupertypes, def.allSupertypes);
                } else {
                    var message = "unknown supertype name " +
                      JSON.stringify(name) +
                      " for subtype " +
                      JSON.stringify(self.typeName);
                    throw new Error(message);
                }
            });

            // TODO Warn if fields are overridden with incompatible types.
            extend(allFields, self.ownFields);
            allSupertypes[self.typeName] = self;

            self.fieldNames.length = 0;
            for (var fieldName in allFields) {
                if (hasOwn.call(allFields, fieldName) &&
                    !allFields[fieldName].hidden) {
                        self.fieldNames.push(fieldName);
                }
            }

            // Types are exported only once they have been finalized.
            Object.defineProperty(namedTypes, self.typeName, {
                enumerable: true,
                value: self.type
            });

            Object.defineProperty(self, "finalized", {value: true});

            // A linearization of the inheritance hierarchy.
            populateSupertypeList(self.typeName, self.supertypeList);

            if (self.buildable && self.supertypeList.lastIndexOf("Expression") >= 0) {
                wrapExpressionBuilderWithStatement(self.typeName);
            }
        }
    };

    // Adds an additional builder for Expression subtypes
    // that wraps the built Expression in an ExpressionStatements.
    function wrapExpressionBuilderWithStatement(typeName) {
        var wrapperName = getStatementBuilderName(typeName);

        // skip if the builder already exists
        if (builders[wrapperName]) return;

        // the builder function to wrap with builders.ExpressionStatement
        var wrapped = builders[getBuilderName(typeName)];

        // skip if there is nothing to wrap
        if (!wrapped) return;

        builders[wrapperName] = function () {
            return builders.expressionStatement(wrapped.apply(builders, arguments));
        };
    }

    function populateSupertypeList(typeName, list) {
        list.length = 0;
        list.push(typeName);

        var lastSeen = Object.create(null);

        for (var pos = 0; pos < list.length; ++pos) {
            typeName = list[pos];
            var d = defCache[typeName];
            if (d.finalized !== true) {
                throw new Error("");
            }

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
        Object.keys(from).forEach(function (name) {
            into[name] = from[name];
        });

        return into;
    };

    exports.finalize = function () {
        Object.keys(defCache).forEach(function (name) {
            defCache[name].finalize();
        });
    };

    return exports;
};

},{}],21:[function(require,module,exports){
module.exports = require('./fork')([
    // This core module of AST types captures ES5 as it is parsed today by
    // git://github.com/ariya/esprima.git#master.
    require("./def/core"),

    // Feel free to add to or remove from this list of extension modules to
    // configure the precise type hierarchy that you need.
    require("./def/es6"),
    require("./def/es7"),
    require("./def/mozilla"),
    require("./def/e4x"),
    require("./def/jsx"),
    require("./def/flow"),
    require("./def/esprima"),
    require("./def/babel"),
    require("./def/babel6")
]);

},{"./def/babel":2,"./def/babel6":4,"./def/core":5,"./def/e4x":6,"./def/es6":7,"./def/es7":8,"./def/esprima":9,"./def/flow":10,"./def/jsx":11,"./def/mozilla":12,"./fork":13}],22:[function(require,module,exports){

},{}],23:[function(require,module,exports){
(function (global){
/*
  Copyright (C) 2012-2014 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2015 Ingvar Stepanyan <me@rreverser.com>
  Copyright (C) 2014 Ivan Nikulin <ifaaan@gmail.com>
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

/*global exports:true, require:true, global:true*/
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
        sourceCode,
        preserveBlankLines,
        FORMAT_MINIFY,
        FORMAT_DEFAULTS;

    estraverse = require('estraverse');
    esutils = require('esutils');

    Syntax = estraverse.Syntax;

    // Generation is done by generateExpression.
    function isExpression(node) {
        return CodeGenerator.Expression.hasOwnProperty(node.type);
    }

    // Generation is done by generateStatement.
    function isStatement(node) {
        return CodeGenerator.Statement.hasOwnProperty(node.type);
    }

    Precedence = {
        Sequence: 0,
        Yield: 1,
        Await: 1,
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
        TaggedTemplate: 17,
        Member: 18,
        Primary: 19
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

    //Flags
    var F_ALLOW_IN = 1,
        F_ALLOW_CALL = 1 << 1,
        F_ALLOW_UNPARATH_NEW = 1 << 2,
        F_FUNC_BODY = 1 << 3,
        F_DIRECTIVE_CTX = 1 << 4,
        F_SEMICOLON_OPT = 1 << 5;

    //Expression flag sets
    //NOTE: Flag order:
    // F_ALLOW_IN
    // F_ALLOW_CALL
    // F_ALLOW_UNPARATH_NEW
    var E_FTT = F_ALLOW_CALL | F_ALLOW_UNPARATH_NEW,
        E_TTF = F_ALLOW_IN | F_ALLOW_CALL,
        E_TTT = F_ALLOW_IN | F_ALLOW_CALL | F_ALLOW_UNPARATH_NEW,
        E_TFF = F_ALLOW_IN,
        E_FFT = F_ALLOW_UNPARATH_NEW,
        E_TFT = F_ALLOW_IN | F_ALLOW_UNPARATH_NEW;

    //Statement flag sets
    //NOTE: Flag order:
    // F_ALLOW_IN
    // F_FUNC_BODY
    // F_DIRECTIVE_CTX
    // F_SEMICOLON_OPT
    var S_TFFF = F_ALLOW_IN,
        S_TFFT = F_ALLOW_IN | F_SEMICOLON_OPT,
        S_FFFF = 0x00,
        S_TFTF = F_ALLOW_IN | F_DIRECTIVE_CTX,
        S_TTFF = F_ALLOW_IN | F_FUNC_BODY;

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
                safeConcatenation: false,
                preserveBlankLines: false
            },
            moz: {
                comprehensionExpressionStartsWithAssignment: false,
                starlessGenerator: false
            },
            sourceMap: null,
            sourceMapRoot: null,
            sourceMapWithCode: false,
            directive: false,
            raw: true,
            verbatim: null,
            sourceCode: null
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

    function merge(target, override) {
        var key;
        for (key in override) {
            if (override.hasOwnProperty(key)) {
                target[key] = override[key];
            }
        }
        return target;
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
        var hex;

        if (code === 0x08  /* \b */) {
            return '\\b';
        }

        if (code === 0x0C  /* \f */) {
            return '\\f';
        }

        if (code === 0x09  /* \t */) {
            return '\\t';
        }

        hex = code.toString(16).toUpperCase();
        if (json || code > 0xFF) {
            return '\\u' + '0000'.slice(hex.length) + hex;
        } else if (code === 0x0000 && !esutils.code.isDecimalDigit(next)) {
            return '\\0';
        } else if (code === 0x000B  /* \v */) { // '\v'
            return '\\x0B';
        } else {
            return '\\x' + '00'.slice(hex.length) + hex;
        }
    }

    function escapeDisallowedCharacter(code) {
        if (code === 0x5C  /* \ */) {
            return '\\\\';
        }

        if (code === 0x0A  /* \n */) {
            return '\\n';
        }

        if (code === 0x0D  /* \r */) {
            return '\\r';
        }

        if (code === 0x2028) {
            return '\\u2028';
        }

        if (code === 0x2029) {
            return '\\u2029';
        }

        throw new Error('Incorrectly classified character');
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
            } else if (!esutils.code.isIdentifierPartES5(code) && (json && code < 0x20  /* SP */ || !json && !escapeless && (code < 0x20  /* SP */ || code > 0x7E  /* ~ */))) {
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
        var leftSource,
            rightSource,
            leftCharCode,
            rightCharCode;

        leftSource = toSourceNodeWhenNeeded(left).toString();
        if (leftSource.length === 0) {
            return [right];
        }

        rightSource = toSourceNodeWhenNeeded(right).toString();
        if (rightSource.length === 0) {
            return [left];
        }

        leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
        rightCharCode = rightSource.charCodeAt(0);

        if ((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode ||
            esutils.code.isIdentifierPartES5(leftCharCode) && esutils.code.isIdentifierPartES5(rightCharCode) ||
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
        var previousBase;
        previousBase = base;
        base += indent;
        fn(base);
        base = previousBase;
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
                var result = '//' + comment.value;
                if (!preserveBlankLines) {
                    result += '\n';
                }
                return result;
            }
        }
        if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
            return adjustMultilineComment('/*' + comment.value + '*/', specialBase);
        }
        return '/*' + comment.value + '*/';
    }

    function addComments(stmt, result) {
        var i, len, comment, save, tailingToStatement, specialBase, fragment,
            extRange, range, prevRange, prefix, infix, suffix, count;

        if (stmt.leadingComments && stmt.leadingComments.length > 0) {
            save = result;

            if (preserveBlankLines) {
                comment = stmt.leadingComments[0];
                result = [];

                extRange = comment.extendedRange;
                range = comment.range;

                prefix = sourceCode.substring(extRange[0], range[0]);
                count = (prefix.match(/\n/g) || []).length;
                if (count > 0) {
                    result.push(stringRepeat('\n', count));
                    result.push(addIndent(generateComment(comment)));
                } else {
                    result.push(prefix);
                    result.push(generateComment(comment));
                }

                prevRange = range;

                for (i = 1, len = stmt.leadingComments.length; i < len; i++) {
                    comment = stmt.leadingComments[i];
                    range = comment.range;

                    infix = sourceCode.substring(prevRange[1], range[0]);
                    count = (infix.match(/\n/g) || []).length;
                    result.push(stringRepeat('\n', count));
                    result.push(addIndent(generateComment(comment)));

                    prevRange = range;
                }

                suffix = sourceCode.substring(range[1], extRange[1]);
                count = (suffix.match(/\n/g) || []).length;
                result.push(stringRepeat('\n', count));
            } else {
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
            }

            result.push(addIndent(save));
        }

        if (stmt.trailingComments) {

            if (preserveBlankLines) {
                comment = stmt.trailingComments[0];
                extRange = comment.extendedRange;
                range = comment.range;

                prefix = sourceCode.substring(extRange[0], range[0]);
                count = (prefix.match(/\n/g) || []).length;

                if (count > 0) {
                    result.push(stringRepeat('\n', count));
                    result.push(addIndent(generateComment(comment)));
                } else {
                    result.push(prefix);
                    result.push(generateComment(comment));
                }
            } else {
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
        }

        return result;
    }

    function generateBlankLines(start, end, result) {
        var j, newlineCount = 0;

        for (j = start; j < end; j++) {
            if (sourceCode[j] === '\n') {
                newlineCount++;
            }
        }

        for (j = 1; j < newlineCount; j++) {
            result.push(newline);
        }
    }

    function parenthesize(text, current, should) {
        if (current < should) {
            return ['(', text, ')'];
        }
        return text;
    }

    function generateVerbatimString(string) {
        var i, iz, result;
        result = string.split(/\r\n|\n/);
        for (i = 1, iz = result.length; i < iz; i++) {
            result[i] = newline + base + result[i];
        }
        return result;
    }

    function generateVerbatim(expr, precedence) {
        var verbatim, result, prec;
        verbatim = expr[extra.verbatim];

        if (typeof verbatim === 'string') {
            result = parenthesize(generateVerbatimString(verbatim), Precedence.Sequence, precedence);
        } else {
            // verbatim is object
            result = generateVerbatimString(verbatim.content);
            prec = (verbatim.precedence != null) ? verbatim.precedence : Precedence.Sequence;
            result = parenthesize(result, prec, precedence);
        }

        return toSourceNodeWhenNeeded(result, expr);
    }

    function CodeGenerator() {
    }

    // Helpers.

    CodeGenerator.prototype.maybeBlock = function(stmt, flags) {
        var result, noLeadingComment, that = this;

        noLeadingComment = !extra.comment || !stmt.leadingComments;

        if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
            return [space, this.generateStatement(stmt, flags)];
        }

        if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
            return ';';
        }

        withIndent(function () {
            result = [
                newline,
                addIndent(that.generateStatement(stmt, flags))
            ];
        });

        return result;
    };

    CodeGenerator.prototype.maybeBlockSuffix = function (stmt, result) {
        var ends = endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
        if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
            return [result, space];
        }
        if (ends) {
            return [result, base];
        }
        return [result, newline, base];
    };

    function generateIdentifier(node) {
        return toSourceNodeWhenNeeded(node.name, node);
    }

    function generateAsyncPrefix(node, spaceRequired) {
        return node.async ? 'async' + (spaceRequired ? noEmptySpace() : space) : '';
    }

    function generateStarSuffix(node) {
        var isGenerator = node.generator && !extra.moz.starlessGenerator;
        return isGenerator ? '*' + space : '';
    }

    function generateMethodPrefix(prop) {
        var func = prop.value;
        if (func.async) {
            return generateAsyncPrefix(func, !prop.computed);
        } else {
            // avoid space before method name
            return generateStarSuffix(func) ? '*' : '';
        }
    }

    CodeGenerator.prototype.generatePattern = function (node, precedence, flags) {
        if (node.type === Syntax.Identifier) {
            return generateIdentifier(node);
        }
        return this.generateExpression(node, precedence, flags);
    };

    CodeGenerator.prototype.generateFunctionParams = function (node) {
        var i, iz, result, hasDefault;

        hasDefault = false;

        if (node.type === Syntax.ArrowFunctionExpression &&
                !node.rest && (!node.defaults || node.defaults.length === 0) &&
                node.params.length === 1 && node.params[0].type === Syntax.Identifier) {
            // arg => { } case
            result = [generateAsyncPrefix(node, true), generateIdentifier(node.params[0])];
        } else {
            result = node.type === Syntax.ArrowFunctionExpression ? [generateAsyncPrefix(node, false)] : [];
            result.push('(');
            if (node.defaults) {
                hasDefault = true;
            }
            for (i = 0, iz = node.params.length; i < iz; ++i) {
                if (hasDefault && node.defaults[i]) {
                    // Handle default values.
                    result.push(this.generateAssignment(node.params[i], node.defaults[i], '=', Precedence.Assignment, E_TTT));
                } else {
                    result.push(this.generatePattern(node.params[i], Precedence.Assignment, E_TTT));
                }
                if (i + 1 < iz) {
                    result.push(',' + space);
                }
            }

            if (node.rest) {
                if (node.params.length) {
                    result.push(',' + space);
                }
                result.push('...');
                result.push(generateIdentifier(node.rest));
            }

            result.push(')');
        }

        return result;
    };

    CodeGenerator.prototype.generateFunctionBody = function (node) {
        var result, expr;

        result = this.generateFunctionParams(node);

        if (node.type === Syntax.ArrowFunctionExpression) {
            result.push(space);
            result.push('=>');
        }

        if (node.expression) {
            result.push(space);
            expr = this.generateExpression(node.body, Precedence.Assignment, E_TTT);
            if (expr.toString().charAt(0) === '{') {
                expr = ['(', expr, ')'];
            }
            result.push(expr);
        } else {
            result.push(this.maybeBlock(node.body, S_TTFF));
        }

        return result;
    };

    CodeGenerator.prototype.generateIterationForStatement = function (operator, stmt, flags) {
        var result = ['for' + space + '('], that = this;
        withIndent(function () {
            if (stmt.left.type === Syntax.VariableDeclaration) {
                withIndent(function () {
                    result.push(stmt.left.kind + noEmptySpace());
                    result.push(that.generateStatement(stmt.left.declarations[0], S_FFFF));
                });
            } else {
                result.push(that.generateExpression(stmt.left, Precedence.Call, E_TTT));
            }

            result = join(result, operator);
            result = [join(
                result,
                that.generateExpression(stmt.right, Precedence.Sequence, E_TTT)
            ), ')'];
        });
        result.push(this.maybeBlock(stmt.body, flags));
        return result;
    };

    CodeGenerator.prototype.generatePropertyKey = function (expr, computed, value) {
        var result = [];

        if (computed) {
            result.push('[');
        }

        if (value.type === 'AssignmentPattern') {
            result.push(this.AssignmentPattern(value, Precedence.Sequence, E_TTT));
        } else {
            result.push(this.generateExpression(expr, Precedence.Sequence, E_TTT));
        }

        if (computed) {
            result.push(']');
        }

        return result;
    };

    CodeGenerator.prototype.generateAssignment = function (left, right, operator, precedence, flags) {
        if (Precedence.Assignment < precedence) {
            flags |= F_ALLOW_IN;
        }

        return parenthesize(
            [
                this.generateExpression(left, Precedence.Call, flags),
                space + operator + space,
                this.generateExpression(right, Precedence.Assignment, flags)
            ],
            Precedence.Assignment,
            precedence
        );
    };

    CodeGenerator.prototype.semicolon = function (flags) {
        if (!semicolons && flags & F_SEMICOLON_OPT) {
            return '';
        }
        return ';';
    };

    // Statements.

    CodeGenerator.Statement = {

        BlockStatement: function (stmt, flags) {
            var range, content, result = ['{', newline], that = this;

            withIndent(function () {
                // handle functions without any code
                if (stmt.body.length === 0 && preserveBlankLines) {
                    range = stmt.range;
                    if (range[1] - range[0] > 2) {
                        content = sourceCode.substring(range[0] + 1, range[1] - 1);
                        if (content[0] === '\n') {
                            result = ['{'];
                        }
                        result.push(content);
                    }
                }

                var i, iz, fragment, bodyFlags;
                bodyFlags = S_TFFF;
                if (flags & F_FUNC_BODY) {
                    bodyFlags |= F_DIRECTIVE_CTX;
                }

                for (i = 0, iz = stmt.body.length; i < iz; ++i) {
                    if (preserveBlankLines) {
                        // handle spaces before the first line
                        if (i === 0) {
                            if (stmt.body[0].leadingComments) {
                                range = stmt.body[0].leadingComments[0].extendedRange;
                                content = sourceCode.substring(range[0], range[1]);
                                if (content[0] === '\n') {
                                    result = ['{'];
                                }
                            }
                            if (!stmt.body[0].leadingComments) {
                                generateBlankLines(stmt.range[0], stmt.body[0].range[0], result);
                            }
                        }

                        // handle spaces between lines
                        if (i > 0) {
                            if (!stmt.body[i - 1].trailingComments  && !stmt.body[i].leadingComments) {
                                generateBlankLines(stmt.body[i - 1].range[1], stmt.body[i].range[0], result);
                            }
                        }
                    }

                    if (i === iz - 1) {
                        bodyFlags |= F_SEMICOLON_OPT;
                    }

                    if (stmt.body[i].leadingComments && preserveBlankLines) {
                        fragment = that.generateStatement(stmt.body[i], bodyFlags);
                    } else {
                        fragment = addIndent(that.generateStatement(stmt.body[i], bodyFlags));
                    }

                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        if (preserveBlankLines && i < iz - 1) {
                            // don't add a new line if there are leading coments
                            // in the next statement
                            if (!stmt.body[i + 1].leadingComments) {
                                result.push(newline);
                            }
                        } else {
                            result.push(newline);
                        }
                    }

                    if (preserveBlankLines) {
                        // handle spaces after the last line
                        if (i === iz - 1) {
                            if (!stmt.body[i].trailingComments) {
                                generateBlankLines(stmt.body[i].range[1], stmt.range[1], result);
                            }
                        }
                    }
                }
            });

            result.push(addIndent('}'));
            return result;
        },

        BreakStatement: function (stmt, flags) {
            if (stmt.label) {
                return 'break ' + stmt.label.name + this.semicolon(flags);
            }
            return 'break' + this.semicolon(flags);
        },

        ContinueStatement: function (stmt, flags) {
            if (stmt.label) {
                return 'continue ' + stmt.label.name + this.semicolon(flags);
            }
            return 'continue' + this.semicolon(flags);
        },

        ClassBody: function (stmt, flags) {
            var result = [ '{', newline], that = this;

            withIndent(function (indent) {
                var i, iz;

                for (i = 0, iz = stmt.body.length; i < iz; ++i) {
                    result.push(indent);
                    result.push(that.generateExpression(stmt.body[i], Precedence.Sequence, E_TTT));
                    if (i + 1 < iz) {
                        result.push(newline);
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(base);
            result.push('}');
            return result;
        },

        ClassDeclaration: function (stmt, flags) {
            var result, fragment;
            result  = ['class'];
            if (stmt.id) {
                result = join(result, this.generateExpression(stmt.id, Precedence.Sequence, E_TTT));
            }
            if (stmt.superClass) {
                fragment = join('extends', this.generateExpression(stmt.superClass, Precedence.Assignment, E_TTT));
                result = join(result, fragment);
            }
            result.push(space);
            result.push(this.generateStatement(stmt.body, S_TFFT));
            return result;
        },

        DirectiveStatement: function (stmt, flags) {
            if (extra.raw && stmt.raw) {
                return stmt.raw + this.semicolon(flags);
            }
            return escapeDirective(stmt.directive) + this.semicolon(flags);
        },

        DoWhileStatement: function (stmt, flags) {
            // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
            var result = join('do', this.maybeBlock(stmt.body, S_TFFF));
            result = this.maybeBlockSuffix(stmt.body, result);
            return join(result, [
                'while' + space + '(',
                this.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                ')' + this.semicolon(flags)
            ]);
        },

        CatchClause: function (stmt, flags) {
            var result, that = this;
            withIndent(function () {
                var guard;

                result = [
                    'catch' + space + '(',
                    that.generateExpression(stmt.param, Precedence.Sequence, E_TTT),
                    ')'
                ];

                if (stmt.guard) {
                    guard = that.generateExpression(stmt.guard, Precedence.Sequence, E_TTT);
                    result.splice(2, 0, ' if ', guard);
                }
            });
            result.push(this.maybeBlock(stmt.body, S_TFFF));
            return result;
        },

        DebuggerStatement: function (stmt, flags) {
            return 'debugger' + this.semicolon(flags);
        },

        EmptyStatement: function (stmt, flags) {
            return ';';
        },

        ExportDefaultDeclaration: function (stmt, flags) {
            var result = [ 'export' ], bodyFlags;

            bodyFlags = (flags & F_SEMICOLON_OPT) ? S_TFFT : S_TFFF;

            // export default HoistableDeclaration[Default]
            // export default AssignmentExpression[In] ;
            result = join(result, 'default');
            if (isStatement(stmt.declaration)) {
                result = join(result, this.generateStatement(stmt.declaration, bodyFlags));
            } else {
                result = join(result, this.generateExpression(stmt.declaration, Precedence.Assignment, E_TTT) + this.semicolon(flags));
            }
            return result;
        },

        ExportNamedDeclaration: function (stmt, flags) {
            var result = [ 'export' ], bodyFlags, that = this;

            bodyFlags = (flags & F_SEMICOLON_OPT) ? S_TFFT : S_TFFF;

            // export VariableStatement
            // export Declaration[Default]
            if (stmt.declaration) {
                return join(result, this.generateStatement(stmt.declaration, bodyFlags));
            }

            // export ExportClause[NoReference] FromClause ;
            // export ExportClause ;
            if (stmt.specifiers) {
                if (stmt.specifiers.length === 0) {
                    result = join(result, '{' + space + '}');
                } else if (stmt.specifiers[0].type === Syntax.ExportBatchSpecifier) {
                    result = join(result, this.generateExpression(stmt.specifiers[0], Precedence.Sequence, E_TTT));
                } else {
                    result = join(result, '{');
                    withIndent(function (indent) {
                        var i, iz;
                        result.push(newline);
                        for (i = 0, iz = stmt.specifiers.length; i < iz; ++i) {
                            result.push(indent);
                            result.push(that.generateExpression(stmt.specifiers[i], Precedence.Sequence, E_TTT));
                            if (i + 1 < iz) {
                                result.push(',' + newline);
                            }
                        }
                    });
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                        result.push(newline);
                    }
                    result.push(base + '}');
                }

                if (stmt.source) {
                    result = join(result, [
                        'from' + space,
                        // ModuleSpecifier
                        this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                        this.semicolon(flags)
                    ]);
                } else {
                    result.push(this.semicolon(flags));
                }
            }
            return result;
        },

        ExportAllDeclaration: function (stmt, flags) {
            // export * FromClause ;
            return [
                'export' + space,
                '*' + space,
                'from' + space,
                // ModuleSpecifier
                this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                this.semicolon(flags)
            ];
        },

        ExpressionStatement: function (stmt, flags) {
            var result, fragment;

            function isClassPrefixed(fragment) {
                var code;
                if (fragment.slice(0, 5) !== 'class') {
                    return false;
                }
                code = fragment.charCodeAt(5);
                return code === 0x7B  /* '{' */ || esutils.code.isWhiteSpace(code) || esutils.code.isLineTerminator(code);
            }

            function isFunctionPrefixed(fragment) {
                var code;
                if (fragment.slice(0, 8) !== 'function') {
                    return false;
                }
                code = fragment.charCodeAt(8);
                return code === 0x28 /* '(' */ || esutils.code.isWhiteSpace(code) || code === 0x2A  /* '*' */ || esutils.code.isLineTerminator(code);
            }

            function isAsyncPrefixed(fragment) {
                var code, i, iz;
                if (fragment.slice(0, 5) !== 'async') {
                    return false;
                }
                if (!esutils.code.isWhiteSpace(fragment.charCodeAt(5))) {
                    return false;
                }
                for (i = 6, iz = fragment.length; i < iz; ++i) {
                    if (!esutils.code.isWhiteSpace(fragment.charCodeAt(i))) {
                        break;
                    }
                }
                if (i === iz) {
                    return false;
                }
                if (fragment.slice(i, i + 8) !== 'function') {
                    return false;
                }
                code = fragment.charCodeAt(i + 8);
                return code === 0x28 /* '(' */ || esutils.code.isWhiteSpace(code) || code === 0x2A  /* '*' */ || esutils.code.isLineTerminator(code);
            }

            result = [this.generateExpression(stmt.expression, Precedence.Sequence, E_TTT)];
            // 12.4 '{', 'function', 'class' is not allowed in this position.
            // wrap expression with parentheses
            fragment = toSourceNodeWhenNeeded(result).toString();
            if (fragment.charCodeAt(0) === 0x7B  /* '{' */ ||  // ObjectExpression
                    isClassPrefixed(fragment) ||
                    isFunctionPrefixed(fragment) ||
                    isAsyncPrefixed(fragment) ||
                    (directive && (flags & F_DIRECTIVE_CTX) && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                result = ['(', result, ')' + this.semicolon(flags)];
            } else {
                result.push(this.semicolon(flags));
            }
            return result;
        },

        ImportDeclaration: function (stmt, flags) {
            // ES6: 15.2.1 valid import declarations:
            //     - import ImportClause FromClause ;
            //     - import ModuleSpecifier ;
            var result, cursor, that = this;

            // If no ImportClause is present,
            // this should be `import ModuleSpecifier` so skip `from`
            // ModuleSpecifier is StringLiteral.
            if (stmt.specifiers.length === 0) {
                // import ModuleSpecifier ;
                return [
                    'import',
                    space,
                    // ModuleSpecifier
                    this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                    this.semicolon(flags)
                ];
            }

            // import ImportClause FromClause ;
            result = [
                'import'
            ];
            cursor = 0;

            // ImportedBinding
            if (stmt.specifiers[cursor].type === Syntax.ImportDefaultSpecifier) {
                result = join(result, [
                        this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT)
                ]);
                ++cursor;
            }

            if (stmt.specifiers[cursor]) {
                if (cursor !== 0) {
                    result.push(',');
                }

                if (stmt.specifiers[cursor].type === Syntax.ImportNamespaceSpecifier) {
                    // NameSpaceImport
                    result = join(result, [
                            space,
                            this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT)
                    ]);
                } else {
                    // NamedImports
                    result.push(space + '{');

                    if ((stmt.specifiers.length - cursor) === 1) {
                        // import { ... } from "...";
                        result.push(space);
                        result.push(this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT));
                        result.push(space + '}' + space);
                    } else {
                        // import {
                        //    ...,
                        //    ...,
                        // } from "...";
                        withIndent(function (indent) {
                            var i, iz;
                            result.push(newline);
                            for (i = cursor, iz = stmt.specifiers.length; i < iz; ++i) {
                                result.push(indent);
                                result.push(that.generateExpression(stmt.specifiers[i], Precedence.Sequence, E_TTT));
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
            }

            result = join(result, [
                'from' + space,
                // ModuleSpecifier
                this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                this.semicolon(flags)
            ]);
            return result;
        },

        VariableDeclarator: function (stmt, flags) {
            var itemFlags = (flags & F_ALLOW_IN) ? E_TTT : E_FTT;
            if (stmt.init) {
                return [
                    this.generateExpression(stmt.id, Precedence.Assignment, itemFlags),
                    space,
                    '=',
                    space,
                    this.generateExpression(stmt.init, Precedence.Assignment, itemFlags)
                ];
            }
            return this.generatePattern(stmt.id, Precedence.Assignment, itemFlags);
        },

        VariableDeclaration: function (stmt, flags) {
            // VariableDeclarator is typed as Statement,
            // but joined with comma (not LineTerminator).
            // So if comment is attached to target node, we should specialize.
            var result, i, iz, node, bodyFlags, that = this;

            result = [ stmt.kind ];

            bodyFlags = (flags & F_ALLOW_IN) ? S_TFFF : S_FFFF;

            function block() {
                node = stmt.declarations[0];
                if (extra.comment && node.leadingComments) {
                    result.push('\n');
                    result.push(addIndent(that.generateStatement(node, bodyFlags)));
                } else {
                    result.push(noEmptySpace());
                    result.push(that.generateStatement(node, bodyFlags));
                }

                for (i = 1, iz = stmt.declarations.length; i < iz; ++i) {
                    node = stmt.declarations[i];
                    if (extra.comment && node.leadingComments) {
                        result.push(',' + newline);
                        result.push(addIndent(that.generateStatement(node, bodyFlags)));
                    } else {
                        result.push(',' + space);
                        result.push(that.generateStatement(node, bodyFlags));
                    }
                }
            }

            if (stmt.declarations.length > 1) {
                withIndent(block);
            } else {
                block();
            }

            result.push(this.semicolon(flags));

            return result;
        },

        ThrowStatement: function (stmt, flags) {
            return [join(
                'throw',
                this.generateExpression(stmt.argument, Precedence.Sequence, E_TTT)
            ), this.semicolon(flags)];
        },

        TryStatement: function (stmt, flags) {
            var result, i, iz, guardedHandlers;

            result = ['try', this.maybeBlock(stmt.block, S_TFFF)];
            result = this.maybeBlockSuffix(stmt.block, result);

            if (stmt.handlers) {
                // old interface
                for (i = 0, iz = stmt.handlers.length; i < iz; ++i) {
                    result = join(result, this.generateStatement(stmt.handlers[i], S_TFFF));
                    if (stmt.finalizer || i + 1 !== iz) {
                        result = this.maybeBlockSuffix(stmt.handlers[i].body, result);
                    }
                }
            } else {
                guardedHandlers = stmt.guardedHandlers || [];

                for (i = 0, iz = guardedHandlers.length; i < iz; ++i) {
                    result = join(result, this.generateStatement(guardedHandlers[i], S_TFFF));
                    if (stmt.finalizer || i + 1 !== iz) {
                        result = this.maybeBlockSuffix(guardedHandlers[i].body, result);
                    }
                }

                // new interface
                if (stmt.handler) {
                    if (isArray(stmt.handler)) {
                        for (i = 0, iz = stmt.handler.length; i < iz; ++i) {
                            result = join(result, this.generateStatement(stmt.handler[i], S_TFFF));
                            if (stmt.finalizer || i + 1 !== iz) {
                                result = this.maybeBlockSuffix(stmt.handler[i].body, result);
                            }
                        }
                    } else {
                        result = join(result, this.generateStatement(stmt.handler, S_TFFF));
                        if (stmt.finalizer) {
                            result = this.maybeBlockSuffix(stmt.handler.body, result);
                        }
                    }
                }
            }
            if (stmt.finalizer) {
                result = join(result, ['finally', this.maybeBlock(stmt.finalizer, S_TFFF)]);
            }
            return result;
        },

        SwitchStatement: function (stmt, flags) {
            var result, fragment, i, iz, bodyFlags, that = this;
            withIndent(function () {
                result = [
                    'switch' + space + '(',
                    that.generateExpression(stmt.discriminant, Precedence.Sequence, E_TTT),
                    ')' + space + '{' + newline
                ];
            });
            if (stmt.cases) {
                bodyFlags = S_TFFF;
                for (i = 0, iz = stmt.cases.length; i < iz; ++i) {
                    if (i === iz - 1) {
                        bodyFlags |= F_SEMICOLON_OPT;
                    }
                    fragment = addIndent(this.generateStatement(stmt.cases[i], bodyFlags));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            }
            result.push(addIndent('}'));
            return result;
        },

        SwitchCase: function (stmt, flags) {
            var result, fragment, i, iz, bodyFlags, that = this;
            withIndent(function () {
                if (stmt.test) {
                    result = [
                        join('case', that.generateExpression(stmt.test, Precedence.Sequence, E_TTT)),
                        ':'
                    ];
                } else {
                    result = ['default:'];
                }

                i = 0;
                iz = stmt.consequent.length;
                if (iz && stmt.consequent[0].type === Syntax.BlockStatement) {
                    fragment = that.maybeBlock(stmt.consequent[0], S_TFFF);
                    result.push(fragment);
                    i = 1;
                }

                if (i !== iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result.push(newline);
                }

                bodyFlags = S_TFFF;
                for (; i < iz; ++i) {
                    if (i === iz - 1 && flags & F_SEMICOLON_OPT) {
                        bodyFlags |= F_SEMICOLON_OPT;
                    }
                    fragment = addIndent(that.generateStatement(stmt.consequent[i], bodyFlags));
                    result.push(fragment);
                    if (i + 1 !== iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });
            return result;
        },

        IfStatement: function (stmt, flags) {
            var result, bodyFlags, semicolonOptional, that = this;
            withIndent(function () {
                result = [
                    'if' + space + '(',
                    that.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                    ')'
                ];
            });
            semicolonOptional = flags & F_SEMICOLON_OPT;
            bodyFlags = S_TFFF;
            if (semicolonOptional) {
                bodyFlags |= F_SEMICOLON_OPT;
            }
            if (stmt.alternate) {
                result.push(this.maybeBlock(stmt.consequent, S_TFFF));
                result = this.maybeBlockSuffix(stmt.consequent, result);
                if (stmt.alternate.type === Syntax.IfStatement) {
                    result = join(result, ['else ', this.generateStatement(stmt.alternate, bodyFlags)]);
                } else {
                    result = join(result, join('else', this.maybeBlock(stmt.alternate, bodyFlags)));
                }
            } else {
                result.push(this.maybeBlock(stmt.consequent, bodyFlags));
            }
            return result;
        },

        ForStatement: function (stmt, flags) {
            var result, that = this;
            withIndent(function () {
                result = ['for' + space + '('];
                if (stmt.init) {
                    if (stmt.init.type === Syntax.VariableDeclaration) {
                        result.push(that.generateStatement(stmt.init, S_FFFF));
                    } else {
                        // F_ALLOW_IN becomes false.
                        result.push(that.generateExpression(stmt.init, Precedence.Sequence, E_FTT));
                        result.push(';');
                    }
                } else {
                    result.push(';');
                }

                if (stmt.test) {
                    result.push(space);
                    result.push(that.generateExpression(stmt.test, Precedence.Sequence, E_TTT));
                    result.push(';');
                } else {
                    result.push(';');
                }

                if (stmt.update) {
                    result.push(space);
                    result.push(that.generateExpression(stmt.update, Precedence.Sequence, E_TTT));
                    result.push(')');
                } else {
                    result.push(')');
                }
            });

            result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
            return result;
        },

        ForInStatement: function (stmt, flags) {
            return this.generateIterationForStatement('in', stmt, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF);
        },

        ForOfStatement: function (stmt, flags) {
            return this.generateIterationForStatement('of', stmt, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF);
        },

        LabeledStatement: function (stmt, flags) {
            return [stmt.label.name + ':', this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF)];
        },

        Program: function (stmt, flags) {
            var result, fragment, i, iz, bodyFlags;
            iz = stmt.body.length;
            result = [safeConcatenation && iz > 0 ? '\n' : ''];
            bodyFlags = S_TFTF;
            for (i = 0; i < iz; ++i) {
                if (!safeConcatenation && i === iz - 1) {
                    bodyFlags |= F_SEMICOLON_OPT;
                }

                if (preserveBlankLines) {
                    // handle spaces before the first line
                    if (i === 0) {
                        if (!stmt.body[0].leadingComments) {
                            generateBlankLines(stmt.range[0], stmt.body[i].range[0], result);
                        }
                    }

                    // handle spaces between lines
                    if (i > 0) {
                        if (!stmt.body[i - 1].trailingComments && !stmt.body[i].leadingComments) {
                            generateBlankLines(stmt.body[i - 1].range[1], stmt.body[i].range[0], result);
                        }
                    }
                }

                fragment = addIndent(this.generateStatement(stmt.body[i], bodyFlags));
                result.push(fragment);
                if (i + 1 < iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    if (preserveBlankLines) {
                        if (!stmt.body[i + 1].leadingComments) {
                            result.push(newline);
                        }
                    } else {
                        result.push(newline);
                    }
                }

                if (preserveBlankLines) {
                    // handle spaces after the last line
                    if (i === iz - 1) {
                        if (!stmt.body[i].trailingComments) {
                            generateBlankLines(stmt.body[i].range[1], stmt.range[1], result);
                        }
                    }
                }
            }
            return result;
        },

        FunctionDeclaration: function (stmt, flags) {
            return [
                generateAsyncPrefix(stmt, true),
                'function',
                generateStarSuffix(stmt) || noEmptySpace(),
                stmt.id ? generateIdentifier(stmt.id) : '',
                this.generateFunctionBody(stmt)
            ];
        },

        ReturnStatement: function (stmt, flags) {
            if (stmt.argument) {
                return [join(
                    'return',
                    this.generateExpression(stmt.argument, Precedence.Sequence, E_TTT)
                ), this.semicolon(flags)];
            }
            return ['return' + this.semicolon(flags)];
        },

        WhileStatement: function (stmt, flags) {
            var result, that = this;
            withIndent(function () {
                result = [
                    'while' + space + '(',
                    that.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                    ')'
                ];
            });
            result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
            return result;
        },

        WithStatement: function (stmt, flags) {
            var result, that = this;
            withIndent(function () {
                result = [
                    'with' + space + '(',
                    that.generateExpression(stmt.object, Precedence.Sequence, E_TTT),
                    ')'
                ];
            });
            result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
            return result;
        }

    };

    merge(CodeGenerator.prototype, CodeGenerator.Statement);

    // Expressions.

    CodeGenerator.Expression = {

        SequenceExpression: function (expr, precedence, flags) {
            var result, i, iz;
            if (Precedence.Sequence < precedence) {
                flags |= F_ALLOW_IN;
            }
            result = [];
            for (i = 0, iz = expr.expressions.length; i < iz; ++i) {
                result.push(this.generateExpression(expr.expressions[i], Precedence.Assignment, flags));
                if (i + 1 < iz) {
                    result.push(',' + space);
                }
            }
            return parenthesize(result, Precedence.Sequence, precedence);
        },

        AssignmentExpression: function (expr, precedence, flags) {
            return this.generateAssignment(expr.left, expr.right, expr.operator, precedence, flags);
        },

        ArrowFunctionExpression: function (expr, precedence, flags) {
            return parenthesize(this.generateFunctionBody(expr), Precedence.ArrowFunction, precedence);
        },

        ConditionalExpression: function (expr, precedence, flags) {
            if (Precedence.Conditional < precedence) {
                flags |= F_ALLOW_IN;
            }
            return parenthesize(
                [
                    this.generateExpression(expr.test, Precedence.LogicalOR, flags),
                    space + '?' + space,
                    this.generateExpression(expr.consequent, Precedence.Assignment, flags),
                    space + ':' + space,
                    this.generateExpression(expr.alternate, Precedence.Assignment, flags)
                ],
                Precedence.Conditional,
                precedence
            );
        },

        LogicalExpression: function (expr, precedence, flags) {
            return this.BinaryExpression(expr, precedence, flags);
        },

        BinaryExpression: function (expr, precedence, flags) {
            var result, currentPrecedence, fragment, leftSource;
            currentPrecedence = BinaryPrecedence[expr.operator];

            if (currentPrecedence < precedence) {
                flags |= F_ALLOW_IN;
            }

            fragment = this.generateExpression(expr.left, currentPrecedence, flags);

            leftSource = fragment.toString();

            if (leftSource.charCodeAt(leftSource.length - 1) === 0x2F /* / */ && esutils.code.isIdentifierPartES5(expr.operator.charCodeAt(0))) {
                result = [fragment, noEmptySpace(), expr.operator];
            } else {
                result = join(fragment, expr.operator);
            }

            fragment = this.generateExpression(expr.right, currentPrecedence + 1, flags);

            if (expr.operator === '/' && fragment.toString().charAt(0) === '/' ||
            expr.operator.slice(-1) === '<' && fragment.toString().slice(0, 3) === '!--') {
                // If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
                result.push(noEmptySpace());
                result.push(fragment);
            } else {
                result = join(result, fragment);
            }

            if (expr.operator === 'in' && !(flags & F_ALLOW_IN)) {
                return ['(', result, ')'];
            }
            return parenthesize(result, currentPrecedence, precedence);
        },

        CallExpression: function (expr, precedence, flags) {
            var result, i, iz;
            // F_ALLOW_UNPARATH_NEW becomes false.
            result = [this.generateExpression(expr.callee, Precedence.Call, E_TTF)];
            result.push('(');
            for (i = 0, iz = expr['arguments'].length; i < iz; ++i) {
                result.push(this.generateExpression(expr['arguments'][i], Precedence.Assignment, E_TTT));
                if (i + 1 < iz) {
                    result.push(',' + space);
                }
            }
            result.push(')');

            if (!(flags & F_ALLOW_CALL)) {
                return ['(', result, ')'];
            }
            return parenthesize(result, Precedence.Call, precedence);
        },

        NewExpression: function (expr, precedence, flags) {
            var result, length, i, iz, itemFlags;
            length = expr['arguments'].length;

            // F_ALLOW_CALL becomes false.
            // F_ALLOW_UNPARATH_NEW may become false.
            itemFlags = (flags & F_ALLOW_UNPARATH_NEW && !parentheses && length === 0) ? E_TFT : E_TFF;

            result = join(
                'new',
                this.generateExpression(expr.callee, Precedence.New, itemFlags)
            );

            if (!(flags & F_ALLOW_UNPARATH_NEW) || parentheses || length > 0) {
                result.push('(');
                for (i = 0, iz = length; i < iz; ++i) {
                    result.push(this.generateExpression(expr['arguments'][i], Precedence.Assignment, E_TTT));
                    if (i + 1 < iz) {
                        result.push(',' + space);
                    }
                }
                result.push(')');
            }

            return parenthesize(result, Precedence.New, precedence);
        },

        MemberExpression: function (expr, precedence, flags) {
            var result, fragment;

            // F_ALLOW_UNPARATH_NEW becomes false.
            result = [this.generateExpression(expr.object, Precedence.Call, (flags & F_ALLOW_CALL) ? E_TTF : E_TFF)];

            if (expr.computed) {
                result.push('[');
                result.push(this.generateExpression(expr.property, Precedence.Sequence, flags & F_ALLOW_CALL ? E_TTT : E_TFT));
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

            return parenthesize(result, Precedence.Member, precedence);
        },

        MetaProperty: function (expr, precedence, flags) {
            var result;
            result = [];
            result.push(expr.meta);
            result.push('.');
            result.push(expr.property);
            return parenthesize(result, Precedence.Member, precedence);
        },

        UnaryExpression: function (expr, precedence, flags) {
            var result, fragment, rightCharCode, leftSource, leftCharCode;
            fragment = this.generateExpression(expr.argument, Precedence.Unary, E_TTT);

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
                            (esutils.code.isIdentifierPartES5(leftCharCode) && esutils.code.isIdentifierPartES5(rightCharCode))) {
                        result.push(noEmptySpace());
                        result.push(fragment);
                    } else {
                        result.push(fragment);
                    }
                }
            }
            return parenthesize(result, Precedence.Unary, precedence);
        },

        YieldExpression: function (expr, precedence, flags) {
            var result;
            if (expr.delegate) {
                result = 'yield*';
            } else {
                result = 'yield';
            }
            if (expr.argument) {
                result = join(
                    result,
                    this.generateExpression(expr.argument, Precedence.Yield, E_TTT)
                );
            }
            return parenthesize(result, Precedence.Yield, precedence);
        },

        AwaitExpression: function (expr, precedence, flags) {
            var result = join(
                expr.all ? 'await*' : 'await',
                this.generateExpression(expr.argument, Precedence.Await, E_TTT)
            );
            return parenthesize(result, Precedence.Await, precedence);
        },

        UpdateExpression: function (expr, precedence, flags) {
            if (expr.prefix) {
                return parenthesize(
                    [
                        expr.operator,
                        this.generateExpression(expr.argument, Precedence.Unary, E_TTT)
                    ],
                    Precedence.Unary,
                    precedence
                );
            }
            return parenthesize(
                [
                    this.generateExpression(expr.argument, Precedence.Postfix, E_TTT),
                    expr.operator
                ],
                Precedence.Postfix,
                precedence
            );
        },

        FunctionExpression: function (expr, precedence, flags) {
            var result = [
                generateAsyncPrefix(expr, true),
                'function'
            ];
            if (expr.id) {
                result.push(generateStarSuffix(expr) || noEmptySpace());
                result.push(generateIdentifier(expr.id));
            } else {
                result.push(generateStarSuffix(expr) || space);
            }
            result.push(this.generateFunctionBody(expr));
            return result;
        },

        ArrayPattern: function (expr, precedence, flags) {
            return this.ArrayExpression(expr, precedence, flags, true);
        },

        ArrayExpression: function (expr, precedence, flags, isPattern) {
            var result, multiline, that = this;
            if (!expr.elements.length) {
                return '[]';
            }
            multiline = isPattern ? false : expr.elements.length > 1;
            result = ['[', multiline ? newline : ''];
            withIndent(function (indent) {
                var i, iz;
                for (i = 0, iz = expr.elements.length; i < iz; ++i) {
                    if (!expr.elements[i]) {
                        if (multiline) {
                            result.push(indent);
                        }
                        if (i + 1 === iz) {
                            result.push(',');
                        }
                    } else {
                        result.push(multiline ? indent : '');
                        result.push(that.generateExpression(expr.elements[i], Precedence.Assignment, E_TTT));
                    }
                    if (i + 1 < iz) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });
            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push(']');
            return result;
        },

        RestElement: function(expr, precedence, flags) {
            return '...' + this.generatePattern(expr.argument);
        },

        ClassExpression: function (expr, precedence, flags) {
            var result, fragment;
            result = ['class'];
            if (expr.id) {
                result = join(result, this.generateExpression(expr.id, Precedence.Sequence, E_TTT));
            }
            if (expr.superClass) {
                fragment = join('extends', this.generateExpression(expr.superClass, Precedence.Assignment, E_TTT));
                result = join(result, fragment);
            }
            result.push(space);
            result.push(this.generateStatement(expr.body, S_TFFT));
            return result;
        },

        MethodDefinition: function (expr, precedence, flags) {
            var result, fragment;
            if (expr['static']) {
                result = ['static' + space];
            } else {
                result = [];
            }
            if (expr.kind === 'get' || expr.kind === 'set') {
                fragment = [
                    join(expr.kind, this.generatePropertyKey(expr.key, expr.computed, expr.value)),
                    this.generateFunctionBody(expr.value)
                ];
            } else {
                fragment = [
                    generateMethodPrefix(expr),
                    this.generatePropertyKey(expr.key, expr.computed, expr.value),
                    this.generateFunctionBody(expr.value)
                ];
            }
            return join(result, fragment);
        },

        Property: function (expr, precedence, flags) {
            if (expr.kind === 'get' || expr.kind === 'set') {
                return [
                    expr.kind, noEmptySpace(),
                    this.generatePropertyKey(expr.key, expr.computed, expr.value),
                    this.generateFunctionBody(expr.value)
                ];
            }

            if (expr.shorthand) {
                return this.generatePropertyKey(expr.key, expr.computed, expr.value);
            }

            if (expr.method) {
                return [
                    generateMethodPrefix(expr),
                    this.generatePropertyKey(expr.key, expr.computed, expr.value),
                    this.generateFunctionBody(expr.value)
                ];
            }

            return [
                this.generatePropertyKey(expr.key, expr.computed, expr.value),
                ':' + space,
                this.generateExpression(expr.value, Precedence.Assignment, E_TTT)
            ];
        },

        ObjectExpression: function (expr, precedence, flags) {
            var multiline, result, fragment, that = this;

            if (!expr.properties.length) {
                return '{}';
            }
            multiline = expr.properties.length > 1;

            withIndent(function () {
                fragment = that.generateExpression(expr.properties[0], Precedence.Sequence, E_TTT);
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
                    return [ '{', space, fragment, space, '}' ];
                }
            }

            withIndent(function (indent) {
                var i, iz;
                result = [ '{', newline, indent, fragment ];

                if (multiline) {
                    result.push(',' + newline);
                    for (i = 1, iz = expr.properties.length; i < iz; ++i) {
                        result.push(indent);
                        result.push(that.generateExpression(expr.properties[i], Precedence.Sequence, E_TTT));
                        if (i + 1 < iz) {
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
            return result;
        },

        AssignmentPattern: function(expr, precedence, flags) {
            return this.generateAssignment(expr.left, expr.right, '=', precedence, flags);
        },

        ObjectPattern: function (expr, precedence, flags) {
            var result, i, iz, multiline, property, that = this;
            if (!expr.properties.length) {
                return '{}';
            }

            multiline = false;
            if (expr.properties.length === 1) {
                property = expr.properties[0];
                if (property.value.type !== Syntax.Identifier) {
                    multiline = true;
                }
            } else {
                for (i = 0, iz = expr.properties.length; i < iz; ++i) {
                    property = expr.properties[i];
                    if (!property.shorthand) {
                        multiline = true;
                        break;
                    }
                }
            }
            result = ['{', multiline ? newline : '' ];

            withIndent(function (indent) {
                var i, iz;
                for (i = 0, iz = expr.properties.length; i < iz; ++i) {
                    result.push(multiline ? indent : '');
                    result.push(that.generateExpression(expr.properties[i], Precedence.Sequence, E_TTT));
                    if (i + 1 < iz) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });

            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push('}');
            return result;
        },

        ThisExpression: function (expr, precedence, flags) {
            return 'this';
        },

        Super: function (expr, precedence, flags) {
            return 'super';
        },

        Identifier: function (expr, precedence, flags) {
            return generateIdentifier(expr);
        },

        ImportDefaultSpecifier: function (expr, precedence, flags) {
            return generateIdentifier(expr.id || expr.local);
        },

        ImportNamespaceSpecifier: function (expr, precedence, flags) {
            var result = ['*'];
            var id = expr.id || expr.local;
            if (id) {
                result.push(space + 'as' + noEmptySpace() + generateIdentifier(id));
            }
            return result;
        },

        ImportSpecifier: function (expr, precedence, flags) {
            var imported = expr.imported;
            var result = [ imported.name ];
            var local = expr.local;
            if (local && local.name !== imported.name) {
                result.push(noEmptySpace() + 'as' + noEmptySpace() + generateIdentifier(local));
            }
            return result;
        },

        ExportSpecifier: function (expr, precedence, flags) {
            var local = expr.local;
            var result = [ local.name ];
            var exported = expr.exported;
            if (exported && exported.name !== local.name) {
                result.push(noEmptySpace() + 'as' + noEmptySpace() + generateIdentifier(exported));
            }
            return result;
        },

        Literal: function (expr, precedence, flags) {
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
        },

        GeneratorExpression: function (expr, precedence, flags) {
            return this.ComprehensionExpression(expr, precedence, flags);
        },

        ComprehensionExpression: function (expr, precedence, flags) {
            // GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
            // Due to https://bugzilla.mozilla.org/show_bug.cgi?id=883468 position of expr.body can differ in Spidermonkey and ES6

            var result, i, iz, fragment, that = this;
            result = (expr.type === Syntax.GeneratorExpression) ? ['('] : ['['];

            if (extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = this.generateExpression(expr.body, Precedence.Assignment, E_TTT);
                result.push(fragment);
            }

            if (expr.blocks) {
                withIndent(function () {
                    for (i = 0, iz = expr.blocks.length; i < iz; ++i) {
                        fragment = that.generateExpression(expr.blocks[i], Precedence.Sequence, E_TTT);
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
                fragment = this.generateExpression(expr.filter, Precedence.Sequence, E_TTT);
                result = join(result, [ '(', fragment, ')' ]);
            }

            if (!extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = this.generateExpression(expr.body, Precedence.Assignment, E_TTT);

                result = join(result, fragment);
            }

            result.push((expr.type === Syntax.GeneratorExpression) ? ')' : ']');
            return result;
        },

        ComprehensionBlock: function (expr, precedence, flags) {
            var fragment;
            if (expr.left.type === Syntax.VariableDeclaration) {
                fragment = [
                    expr.left.kind, noEmptySpace(),
                    this.generateStatement(expr.left.declarations[0], S_FFFF)
                ];
            } else {
                fragment = this.generateExpression(expr.left, Precedence.Call, E_TTT);
            }

            fragment = join(fragment, expr.of ? 'of' : 'in');
            fragment = join(fragment, this.generateExpression(expr.right, Precedence.Sequence, E_TTT));

            return [ 'for' + space + '(', fragment, ')' ];
        },

        SpreadElement: function (expr, precedence, flags) {
            return [
                '...',
                this.generateExpression(expr.argument, Precedence.Assignment, E_TTT)
            ];
        },

        TaggedTemplateExpression: function (expr, precedence, flags) {
            var itemFlags = E_TTF;
            if (!(flags & F_ALLOW_CALL)) {
                itemFlags = E_TFF;
            }
            var result = [
                this.generateExpression(expr.tag, Precedence.Call, itemFlags),
                this.generateExpression(expr.quasi, Precedence.Primary, E_FFT)
            ];
            return parenthesize(result, Precedence.TaggedTemplate, precedence);
        },

        TemplateElement: function (expr, precedence, flags) {
            // Don't use "cooked". Since tagged template can use raw template
            // representation. So if we do so, it breaks the script semantics.
            return expr.value.raw;
        },

        TemplateLiteral: function (expr, precedence, flags) {
            var result, i, iz;
            result = [ '`' ];
            for (i = 0, iz = expr.quasis.length; i < iz; ++i) {
                result.push(this.generateExpression(expr.quasis[i], Precedence.Primary, E_TTT));
                if (i + 1 < iz) {
                    result.push('${' + space);
                    result.push(this.generateExpression(expr.expressions[i], Precedence.Sequence, E_TTT));
                    result.push(space + '}');
                }
            }
            result.push('`');
            return result;
        },

        ModuleSpecifier: function (expr, precedence, flags) {
            return this.Literal(expr, precedence, flags);
        }

    };

    merge(CodeGenerator.prototype, CodeGenerator.Expression);

    CodeGenerator.prototype.generateExpression = function (expr, precedence, flags) {
        var result, type;

        type = expr.type || Syntax.Property;

        if (extra.verbatim && expr.hasOwnProperty(extra.verbatim)) {
            return generateVerbatim(expr, precedence);
        }

        result = this[type](expr, precedence, flags);


        if (extra.comment) {
            result = addComments(expr, result);
        }
        return toSourceNodeWhenNeeded(result, expr);
    };

    CodeGenerator.prototype.generateStatement = function (stmt, flags) {
        var result,
            fragment;

        result = this[stmt.type](stmt, flags);

        // Attach comments

        if (extra.comment) {
            result = addComments(stmt, result);
        }

        fragment = toSourceNodeWhenNeeded(result).toString();
        if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
            result = sourceMap ? toSourceNodeWhenNeeded(result).replaceRight(/\s+$/, '') : fragment.replace(/\s+$/, '');
        }

        return toSourceNodeWhenNeeded(result, stmt);
    };

    function generateInternal(node) {
        var codegen;

        codegen = new CodeGenerator();
        if (isStatement(node)) {
            return codegen.generateStatement(node, S_TFFF);
        }

        if (isExpression(node)) {
            return codegen.generateExpression(node, Precedence.Sequence, E_TTT);
        }

        throw new Error('Unknown node type: ' + node.type);
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
        sourceCode = options.sourceCode;
        preserveBlankLines = options.format.preserveBlankLines && sourceCode !== null;
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

        result = generateInternal(node);

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

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./package.json":24,"estraverse":25,"esutils":29,"source-map":32}],24:[function(require,module,exports){
module.exports={
  "_args": [
    [
      "escodegen",
      "/home/oni/iota"
    ]
  ],
  "_from": "escodegen@latest",
  "_id": "escodegen@1.8.1",
  "_inCache": true,
  "_installable": true,
  "_location": "/escodegen",
  "_nodeVersion": "6.3.0",
  "_npmOperationalInternal": {
    "host": "packages-12-west.internal.npmjs.com",
    "tmp": "tmp/escodegen-1.8.1.tgz_1470506723009_0.12818681285716593"
  },
  "_npmUser": {
    "email": "npm@michael.ficarra.me",
    "name": "michaelficarra"
  },
  "_npmVersion": "3.10.3",
  "_phantomChildren": {},
  "_requested": {
    "name": "escodegen",
    "raw": "escodegen",
    "rawSpec": "",
    "scope": null,
    "spec": "latest",
    "type": "tag"
  },
  "_requiredBy": [
    "#USER"
  ],
  "_resolved": "https://registry.npmjs.org/escodegen/-/escodegen-1.8.1.tgz",
  "_shasum": "5a5b53af4693110bebb0867aa3430dd3b70a1018",
  "_shrinkwrap": null,
  "_spec": "escodegen",
  "_where": "/home/oni/iota",
  "bin": {
    "escodegen": "./bin/escodegen.js",
    "esgenerate": "./bin/esgenerate.js"
  },
  "bugs": {
    "url": "https://github.com/estools/escodegen/issues"
  },
  "dependencies": {
    "esprima": "^2.7.1",
    "estraverse": "^1.9.1",
    "esutils": "^2.0.2",
    "optionator": "^0.8.1",
    "source-map": "~0.2.0"
  },
  "description": "ECMAScript code generator",
  "devDependencies": {
    "acorn": "^2.7.0",
    "bluebird": "^2.3.11",
    "bower-registry-client": "^0.2.1",
    "chai": "^1.10.0",
    "commonjs-everywhere": "^0.9.7",
    "gulp": "^3.8.10",
    "gulp-eslint": "^0.2.0",
    "gulp-mocha": "^2.0.0",
    "semver": "^5.1.0"
  },
  "directories": {},
  "dist": {
    "shasum": "5a5b53af4693110bebb0867aa3430dd3b70a1018",
    "tarball": "https://registry.npmjs.org/escodegen/-/escodegen-1.8.1.tgz"
  },
  "engines": {
    "node": ">=0.12.0"
  },
  "files": [
    "LICENSE.BSD",
    "LICENSE.source-map",
    "README.md",
    "bin",
    "escodegen.js",
    "package.json"
  ],
  "gitHead": "ba4faabb224b2d5e0080c8e4f964702b699c7d1f",
  "homepage": "http://github.com/estools/escodegen",
  "license": "BSD-2-Clause",
  "main": "escodegen.js",
  "maintainers": [
    {
      "name": "constellation",
      "email": "utatane.tea@gmail.com"
    },
    {
      "name": "michaelficarra",
      "email": "npm@michael.ficarra.me"
    }
  ],
  "name": "escodegen",
  "optionalDependencies": {
    "source-map": "~0.2.0"
  },
  "readme": "ERROR: No README data found!",
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/estools/escodegen.git"
  },
  "scripts": {
    "build": "cjsify -a path: tools/entry-point.js > escodegen.browser.js",
    "build-min": "cjsify -ma path: tools/entry-point.js > escodegen.browser.min.js",
    "lint": "gulp lint",
    "release": "node tools/release.js",
    "test": "gulp travis",
    "unit-test": "gulp test"
  },
  "version": "1.8.1"
}

},{}],25:[function(require,module,exports){
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
}(this, function clone(exports) {
    'use strict';

    var Syntax,
        isArray,
        VisitorOption,
        VisitorKeys,
        objectCreate,
        objectKeys,
        BREAK,
        SKIP,
        REMOVE;

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

    objectCreate = Object.create || (function () {
        function F() { }

        return function (o) {
            F.prototype = o;
            return new F();
        };
    })();

    objectKeys = Object.keys || function (o) {
        var keys = [], key;
        for (key in o) {
            keys.push(key);
        }
        return keys;
    };

    function extend(to, from) {
        var keys = objectKeys(from), key, i, len;
        for (i = 0, len = keys.length; i < len; i += 1) {
            key = keys[i];
            to[key] = from[key];
        }
        return to;
    }

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        AwaitExpression: 'AwaitExpression', // CAUTION: It's deferred to ES7.
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ClassBody: 'ClassBody',
        ClassDeclaration: 'ClassDeclaration',
        ClassExpression: 'ClassExpression',
        ComprehensionBlock: 'ComprehensionBlock',  // CAUTION: It's deferred to ES7.
        ComprehensionExpression: 'ComprehensionExpression',  // CAUTION: It's deferred to ES7.
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExportBatchSpecifier: 'ExportBatchSpecifier',
        ExportDeclaration: 'ExportDeclaration',
        ExportSpecifier: 'ExportSpecifier',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        ForOfStatement: 'ForOfStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        GeneratorExpression: 'GeneratorExpression',  // CAUTION: It's deferred to ES7.
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        ImportDeclaration: 'ImportDeclaration',
        ImportDefaultSpecifier: 'ImportDefaultSpecifier',
        ImportNamespaceSpecifier: 'ImportNamespaceSpecifier',
        ImportSpecifier: 'ImportSpecifier',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        MethodDefinition: 'MethodDefinition',
        ModuleSpecifier: 'ModuleSpecifier',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SpreadElement: 'SpreadElement',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        TaggedTemplateExpression: 'TaggedTemplateExpression',
        TemplateElement: 'TemplateElement',
        TemplateLiteral: 'TemplateLiteral',
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

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        ArrayExpression: ['elements'],
        ArrayPattern: ['elements'],
        ArrowFunctionExpression: ['params', 'defaults', 'rest', 'body'],
        AwaitExpression: ['argument'], // CAUTION: It's deferred to ES7.
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ClassBody: ['body'],
        ClassDeclaration: ['id', 'body', 'superClass'],
        ClassExpression: ['id', 'body', 'superClass'],
        ComprehensionBlock: ['left', 'right'],  // CAUTION: It's deferred to ES7.
        ComprehensionExpression: ['blocks', 'filter', 'body'],  // CAUTION: It's deferred to ES7.
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DebuggerStatement: [],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        EmptyStatement: [],
        ExportBatchSpecifier: [],
        ExportDeclaration: ['declaration', 'specifiers', 'source'],
        ExportSpecifier: ['id', 'name'],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        ForOfStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'defaults', 'rest', 'body'],
        FunctionExpression: ['id', 'params', 'defaults', 'rest', 'body'],
        GeneratorExpression: ['blocks', 'filter', 'body'],  // CAUTION: It's deferred to ES7.
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        ImportDeclaration: ['specifiers', 'source'],
        ImportDefaultSpecifier: ['id'],
        ImportNamespaceSpecifier: ['id'],
        ImportSpecifier: ['id', 'name'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        MethodDefinition: ['key', 'value'],
        ModuleSpecifier: [],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        ObjectPattern: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SpreadElement: ['argument'],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        TaggedTemplateExpression: ['tag', 'quasi'],
        TemplateElement: [],
        TemplateLiteral: ['quasis', 'expressions'],
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
    REMOVE = {};

    VisitorOption = {
        Break: BREAK,
        Skip: SKIP,
        Remove: REMOVE
    };

    function Reference(parent, key) {
        this.parent = parent;
        this.key = key;
    }

    Reference.prototype.replace = function replace(node) {
        this.parent[this.key] = node;
    };

    Reference.prototype.remove = function remove() {
        if (isArray(this.parent)) {
            this.parent.splice(this.key, 1);
            return true;
        } else {
            this.replace(null);
            return false;
        }
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
    // return type of current node
    Controller.prototype.type = function () {
        var node = this.current();
        return node.type || this.__current.wrap;
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

    // API:
    // remove node
    Controller.prototype.remove = function () {
        this.notify(REMOVE);
    };

    Controller.prototype.__initialize = function(root, visitor) {
        this.visitor = visitor;
        this.root = root;
        this.__worklist = [];
        this.__leavelist = [];
        this.__current = null;
        this.__state = null;
        this.__fallback = visitor.fallback === 'iteration';
        this.__keys = VisitorKeys;
        if (visitor.keys) {
            this.__keys = extend(objectCreate(this.__keys), visitor.keys);
        }
    };

    function isNode(node) {
        if (node == null) {
            return false;
        }
        return typeof node === 'object' && typeof node.type === 'string';
    }

    function isProperty(nodeType, key) {
        return (nodeType === Syntax.ObjectExpression || nodeType === Syntax.ObjectPattern) && 'properties' === key;
    }

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
                candidates = this.__keys[nodeType];
                if (!candidates) {
                    if (this.__fallback) {
                        candidates = objectKeys(node);
                    } else {
                        throw new Error('Unknown node type ' + nodeType + '.');
                    }
                }

                current = candidates.length;
                while ((current -= 1) >= 0) {
                    key = candidates[current];
                    candidate = node[key];
                    if (!candidate) {
                        continue;
                    }

                    if (isArray(candidate)) {
                        current2 = candidate.length;
                        while ((current2 -= 1) >= 0) {
                            if (!candidate[current2]) {
                                continue;
                            }
                            if (isProperty(nodeType, candidates[current])) {
                                element = new Element(candidate[current2], [key, current2], 'Property', null);
                            } else if (isNode(candidate[current2])) {
                                element = new Element(candidate[current2], [key, current2], null, null);
                            } else {
                                continue;
                            }
                            worklist.push(element);
                        }
                    } else if (isNode(candidate)) {
                        worklist.push(new Element(candidate, key, null, null));
                    }
                }
            }
        }
    };

    Controller.prototype.replace = function replace(root, visitor) {
        function removeElem(element) {
            var i,
                key,
                nextElem,
                parent;

            if (element.ref.remove()) {
                // When the reference is an element of an array.
                key = element.ref.key;
                parent = element.ref.parent;

                // If removed from array, then decrease following items' keys.
                i = worklist.length;
                while (i--) {
                    nextElem = worklist[i];
                    if (nextElem.ref && nextElem.ref.parent === parent) {
                        if  (nextElem.ref.key < key) {
                            break;
                        }
                        --nextElem.ref.key;
                    }
                }
            }
        }

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
                if (target !== undefined && target !== BREAK && target !== SKIP && target !== REMOVE) {
                    // replace
                    element.ref.replace(target);
                }

                if (this.__state === REMOVE || target === REMOVE) {
                    removeElem(element);
                }

                if (this.__state === BREAK || target === BREAK) {
                    return outer.root;
                }
                continue;
            }

            target = this.__execute(visitor.enter, element);

            // node may be replaced with null,
            // so distinguish between undefined and null in this place
            if (target !== undefined && target !== BREAK && target !== SKIP && target !== REMOVE) {
                // replace
                element.ref.replace(target);
                element.node = target;
            }

            if (this.__state === REMOVE || target === REMOVE) {
                removeElem(element);
                element.node = null;
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
            candidates = this.__keys[nodeType];
            if (!candidates) {
                if (this.__fallback) {
                    candidates = objectKeys(node);
                } else {
                    throw new Error('Unknown node type ' + nodeType + '.');
                }
            }

            current = candidates.length;
            while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = node[key];
                if (!candidate) {
                    continue;
                }

                if (isArray(candidate)) {
                    current2 = candidate.length;
                    while ((current2 -= 1) >= 0) {
                        if (!candidate[current2]) {
                            continue;
                        }
                        if (isProperty(nodeType, candidates[current])) {
                            element = new Element(candidate[current2], [key, current2], 'Property', new Reference(candidate, current2));
                        } else if (isNode(candidate[current2])) {
                            element = new Element(candidate[current2], [key, current2], null, new Reference(candidate, current2));
                        } else {
                            continue;
                        }
                        worklist.push(element);
                    }
                } else if (isNode(candidate)) {
                    worklist.push(new Element(candidate, key, null, new Reference(node, key)));
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

    exports.version = '1.8.1-dev';
    exports.Syntax = Syntax;
    exports.traverse = traverse;
    exports.replace = replace;
    exports.attachComments = attachComments;
    exports.VisitorKeys = VisitorKeys;
    exports.VisitorOption = VisitorOption;
    exports.Controller = Controller;
    exports.cloneEnvironment = function () { return clone({}); };

    return exports;
}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],26:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS 'AS IS'
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

    function isExpression(node) {
        if (node == null) { return false; }
        switch (node.type) {
            case 'ArrayExpression':
            case 'AssignmentExpression':
            case 'BinaryExpression':
            case 'CallExpression':
            case 'ConditionalExpression':
            case 'FunctionExpression':
            case 'Identifier':
            case 'Literal':
            case 'LogicalExpression':
            case 'MemberExpression':
            case 'NewExpression':
            case 'ObjectExpression':
            case 'SequenceExpression':
            case 'ThisExpression':
            case 'UnaryExpression':
            case 'UpdateExpression':
                return true;
        }
        return false;
    }

    function isIterationStatement(node) {
        if (node == null) { return false; }
        switch (node.type) {
            case 'DoWhileStatement':
            case 'ForInStatement':
            case 'ForStatement':
            case 'WhileStatement':
                return true;
        }
        return false;
    }

    function isStatement(node) {
        if (node == null) { return false; }
        switch (node.type) {
            case 'BlockStatement':
            case 'BreakStatement':
            case 'ContinueStatement':
            case 'DebuggerStatement':
            case 'DoWhileStatement':
            case 'EmptyStatement':
            case 'ExpressionStatement':
            case 'ForInStatement':
            case 'ForStatement':
            case 'IfStatement':
            case 'LabeledStatement':
            case 'ReturnStatement':
            case 'SwitchStatement':
            case 'ThrowStatement':
            case 'TryStatement':
            case 'VariableDeclaration':
            case 'WhileStatement':
            case 'WithStatement':
                return true;
        }
        return false;
    }

    function isSourceElement(node) {
      return isStatement(node) || node != null && node.type === 'FunctionDeclaration';
    }

    function trailingStatement(node) {
        switch (node.type) {
        case 'IfStatement':
            if (node.alternate != null) {
                return node.alternate;
            }
            return node.consequent;

        case 'LabeledStatement':
        case 'ForStatement':
        case 'ForInStatement':
        case 'WhileStatement':
        case 'WithStatement':
            return node.body;
        }
        return null;
    }

    function isProblematicIfStatement(node) {
        var current;

        if (node.type !== 'IfStatement') {
            return false;
        }
        if (node.alternate == null) {
            return false;
        }
        current = node.consequent;
        do {
            if (current.type === 'IfStatement') {
                if (current.alternate == null)  {
                    return true;
                }
            }
            current = trailingStatement(current);
        } while (current);

        return false;
    }

    module.exports = {
        isExpression: isExpression,
        isStatement: isStatement,
        isIterationStatement: isIterationStatement,
        isSourceElement: isSourceElement,
        isProblematicIfStatement: isProblematicIfStatement,

        trailingStatement: trailingStatement
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],27:[function(require,module,exports){
/*
  Copyright (C) 2013-2014 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2014 Ivan Nikulin <ifaaan@gmail.com>

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

    var ES6Regex, ES5Regex, NON_ASCII_WHITESPACES, IDENTIFIER_START, IDENTIFIER_PART, ch;

    // See `tools/generate-identifier-regex.js`.
    ES5Regex = {
        // ECMAScript 5.1/Unicode v7.0.0 NonAsciiIdentifierStart:
        NonAsciiIdentifierStart: /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B2\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/,
        // ECMAScript 5.1/Unicode v7.0.0 NonAsciiIdentifierPart:
        NonAsciiIdentifierPart: /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B2\u08E4-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA69D\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2D\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/
    };

    ES6Regex = {
        // ECMAScript 6/Unicode v7.0.0 NonAsciiIdentifierStart:
        NonAsciiIdentifierStart: /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B2\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDE80-\uDE9C\uDEA0-\uDED0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF75\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00\uDE10-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE4\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48]|\uD804[\uDC03-\uDC37\uDC83-\uDCAF\uDCD0-\uDCE8\uDD03-\uDD26\uDD50-\uDD72\uDD76\uDD83-\uDDB2\uDDC1-\uDDC4\uDDDA\uDE00-\uDE11\uDE13-\uDE2B\uDEB0-\uDEDE\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3D\uDF5D-\uDF61]|\uD805[\uDC80-\uDCAF\uDCC4\uDCC5\uDCC7\uDD80-\uDDAE\uDE00-\uDE2F\uDE44\uDE80-\uDEAA]|\uD806[\uDCA0-\uDCDF\uDCFF\uDEC0-\uDEF8]|\uD808[\uDC00-\uDF98]|\uD809[\uDC00-\uDC6E]|[\uD80C\uD840-\uD868\uD86A-\uD86C][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDED0-\uDEED\uDF00-\uDF2F\uDF40-\uDF43\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50\uDF93-\uDF9F]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB]|\uD83A[\uDC00-\uDCC4]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D]|\uD87E[\uDC00-\uDE1D]/,
        // ECMAScript 6/Unicode v7.0.0 NonAsciiIdentifierPart:
        NonAsciiIdentifierPart: /[\xAA\xB5\xB7\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B2\u08E4-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1369-\u1371\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19DA\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA69D\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2D\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDDFD\uDE80-\uDE9C\uDEA0-\uDED0\uDEE0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF7A\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDCA0-\uDCA9\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00-\uDE03\uDE05\uDE06\uDE0C-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE38-\uDE3A\uDE3F\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE6\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48]|\uD804[\uDC00-\uDC46\uDC66-\uDC6F\uDC7F-\uDCBA\uDCD0-\uDCE8\uDCF0-\uDCF9\uDD00-\uDD34\uDD36-\uDD3F\uDD50-\uDD73\uDD76\uDD80-\uDDC4\uDDD0-\uDDDA\uDE00-\uDE11\uDE13-\uDE37\uDEB0-\uDEEA\uDEF0-\uDEF9\uDF01-\uDF03\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3C-\uDF44\uDF47\uDF48\uDF4B-\uDF4D\uDF57\uDF5D-\uDF63\uDF66-\uDF6C\uDF70-\uDF74]|\uD805[\uDC80-\uDCC5\uDCC7\uDCD0-\uDCD9\uDD80-\uDDB5\uDDB8-\uDDC0\uDE00-\uDE40\uDE44\uDE50-\uDE59\uDE80-\uDEB7\uDEC0-\uDEC9]|\uD806[\uDCA0-\uDCE9\uDCFF\uDEC0-\uDEF8]|\uD808[\uDC00-\uDF98]|\uD809[\uDC00-\uDC6E]|[\uD80C\uD840-\uD868\uD86A-\uD86C][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDE60-\uDE69\uDED0-\uDEED\uDEF0-\uDEF4\uDF00-\uDF36\uDF40-\uDF43\uDF50-\uDF59\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50-\uDF7E\uDF8F-\uDF9F]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99\uDC9D\uDC9E]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72\uDD7B-\uDD82\uDD85-\uDD8B\uDDAA-\uDDAD\uDE42-\uDE44]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB\uDFCE-\uDFFF]|\uD83A[\uDC00-\uDCC4\uDCD0-\uDCD6]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D]|\uD87E[\uDC00-\uDE1D]|\uDB40[\uDD00-\uDDEF]/
    };

    function isDecimalDigit(ch) {
        return 0x30 <= ch && ch <= 0x39;  // 0..9
    }

    function isHexDigit(ch) {
        return 0x30 <= ch && ch <= 0x39 ||  // 0..9
            0x61 <= ch && ch <= 0x66 ||     // a..f
            0x41 <= ch && ch <= 0x46;       // A..F
    }

    function isOctalDigit(ch) {
        return ch >= 0x30 && ch <= 0x37;  // 0..7
    }

    // 7.2 White Space

    NON_ASCII_WHITESPACES = [
        0x1680, 0x180E,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
        0x202F, 0x205F,
        0x3000,
        0xFEFF
    ];

    function isWhiteSpace(ch) {
        return ch === 0x20 || ch === 0x09 || ch === 0x0B || ch === 0x0C || ch === 0xA0 ||
            ch >= 0x1680 && NON_ASCII_WHITESPACES.indexOf(ch) >= 0;
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return ch === 0x0A || ch === 0x0D || ch === 0x2028 || ch === 0x2029;
    }

    // 7.6 Identifier Names and Identifiers

    function fromCodePoint(cp) {
        if (cp <= 0xFFFF) { return String.fromCharCode(cp); }
        var cu1 = String.fromCharCode(Math.floor((cp - 0x10000) / 0x400) + 0xD800);
        var cu2 = String.fromCharCode(((cp - 0x10000) % 0x400) + 0xDC00);
        return cu1 + cu2;
    }

    IDENTIFIER_START = new Array(0x80);
    for(ch = 0; ch < 0x80; ++ch) {
        IDENTIFIER_START[ch] =
            ch >= 0x61 && ch <= 0x7A ||  // a..z
            ch >= 0x41 && ch <= 0x5A ||  // A..Z
            ch === 0x24 || ch === 0x5F;  // $ (dollar) and _ (underscore)
    }

    IDENTIFIER_PART = new Array(0x80);
    for(ch = 0; ch < 0x80; ++ch) {
        IDENTIFIER_PART[ch] =
            ch >= 0x61 && ch <= 0x7A ||  // a..z
            ch >= 0x41 && ch <= 0x5A ||  // A..Z
            ch >= 0x30 && ch <= 0x39 ||  // 0..9
            ch === 0x24 || ch === 0x5F;  // $ (dollar) and _ (underscore)
    }

    function isIdentifierStartES5(ch) {
        return ch < 0x80 ? IDENTIFIER_START[ch] : ES5Regex.NonAsciiIdentifierStart.test(fromCodePoint(ch));
    }

    function isIdentifierPartES5(ch) {
        return ch < 0x80 ? IDENTIFIER_PART[ch] : ES5Regex.NonAsciiIdentifierPart.test(fromCodePoint(ch));
    }

    function isIdentifierStartES6(ch) {
        return ch < 0x80 ? IDENTIFIER_START[ch] : ES6Regex.NonAsciiIdentifierStart.test(fromCodePoint(ch));
    }

    function isIdentifierPartES6(ch) {
        return ch < 0x80 ? IDENTIFIER_PART[ch] : ES6Regex.NonAsciiIdentifierPart.test(fromCodePoint(ch));
    }

    module.exports = {
        isDecimalDigit: isDecimalDigit,
        isHexDigit: isHexDigit,
        isOctalDigit: isOctalDigit,
        isWhiteSpace: isWhiteSpace,
        isLineTerminator: isLineTerminator,
        isIdentifierStartES5: isIdentifierStartES5,
        isIdentifierPartES5: isIdentifierPartES5,
        isIdentifierStartES6: isIdentifierStartES6,
        isIdentifierPartES6: isIdentifierPartES6
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],28:[function(require,module,exports){
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

    function isReservedWordES5(id, strict) {
        return id === 'null' || id === 'true' || id === 'false' || isKeywordES5(id, strict);
    }

    function isReservedWordES6(id, strict) {
        return id === 'null' || id === 'true' || id === 'false' || isKeywordES6(id, strict);
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    function isIdentifierNameES5(id) {
        var i, iz, ch;

        if (id.length === 0) { return false; }

        ch = id.charCodeAt(0);
        if (!code.isIdentifierStartES5(ch)) {
            return false;
        }

        for (i = 1, iz = id.length; i < iz; ++i) {
            ch = id.charCodeAt(i);
            if (!code.isIdentifierPartES5(ch)) {
                return false;
            }
        }
        return true;
    }

    function decodeUtf16(lead, trail) {
        return (lead - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000;
    }

    function isIdentifierNameES6(id) {
        var i, iz, ch, lowCh, check;

        if (id.length === 0) { return false; }

        check = code.isIdentifierStartES6;
        for (i = 0, iz = id.length; i < iz; ++i) {
            ch = id.charCodeAt(i);
            if (0xD800 <= ch && ch <= 0xDBFF) {
                ++i;
                if (i >= iz) { return false; }
                lowCh = id.charCodeAt(i);
                if (!(0xDC00 <= lowCh && lowCh <= 0xDFFF)) {
                    return false;
                }
                ch = decodeUtf16(ch, lowCh);
            }
            if (!check(ch)) {
                return false;
            }
            check = code.isIdentifierPartES6;
        }
        return true;
    }

    function isIdentifierES5(id, strict) {
        return isIdentifierNameES5(id) && !isReservedWordES5(id, strict);
    }

    function isIdentifierES6(id, strict) {
        return isIdentifierNameES6(id) && !isReservedWordES6(id, strict);
    }

    module.exports = {
        isKeywordES5: isKeywordES5,
        isKeywordES6: isKeywordES6,
        isReservedWordES5: isReservedWordES5,
        isReservedWordES6: isReservedWordES6,
        isRestrictedWord: isRestrictedWord,
        isIdentifierNameES5: isIdentifierNameES5,
        isIdentifierNameES6: isIdentifierNameES6,
        isIdentifierES5: isIdentifierES5,
        isIdentifierES6: isIdentifierES6
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":27}],29:[function(require,module,exports){
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

    exports.ast = require('./ast');
    exports.code = require('./code');
    exports.keyword = require('./keyword');
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./ast":26,"./code":27,"./keyword":28}],30:[function(require,module,exports){
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

}).call(this,require('_process'))
},{"_process":31}],31:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],32:[function(require,module,exports){
/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = require('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = require('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = require('./source-map/source-node').SourceNode;

},{"./source-map/source-map-consumer":40,"./source-map/source-map-generator":41,"./source-map/source-node":42}],33:[function(require,module,exports){
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

},{"./util":43,"amdefine":1}],34:[function(require,module,exports){
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

},{"./base64":35,"amdefine":1}],35:[function(require,module,exports){
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

},{"amdefine":1}],36:[function(require,module,exports){
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
  var SourceMapConsumer = require('./source-map-consumer').SourceMapConsumer;

  /**
   * A BasicSourceMapConsumer instance represents a parsed source map which we can
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
  function BasicSourceMapConsumer(aSourceMap) {
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

  BasicSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
  BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer;

  /**
   * Create a BasicSourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @returns BasicSourceMapConsumer
   */
  BasicSourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap) {
      var smc = Object.create(BasicSourceMapConsumer.prototype);

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
  BasicSourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(BasicSourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot != null ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  BasicSourceMapConsumer.prototype._parseMappings =
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
  BasicSourceMapConsumer.prototype._findMapping =
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
  BasicSourceMapConsumer.prototype.computeColumnSpans =
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
  BasicSourceMapConsumer.prototype.originalPositionFor =
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
  BasicSourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
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

      // This function is used recursively from
      // IndexedSourceMapConsumer.prototype.sourceContentFor. In that case, we
      // don't want to throw if we can't find the source - we just want to
      // return null, so we provide a flag to exit gracefully.
      if (nullOnMissing) {
        return null;
      }
      else {
        throw new Error('"' + aSource + '" is not in the SourceMap.');
      }
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
  BasicSourceMapConsumer.prototype.generatedPositionFor =
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

  exports.BasicSourceMapConsumer = BasicSourceMapConsumer;

});

},{"./array-set":33,"./base64-vlq":34,"./binary-search":37,"./source-map-consumer":40,"./util":43,"amdefine":1}],37:[function(require,module,exports){
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

},{"amdefine":1}],38:[function(require,module,exports){
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
  var SourceMapConsumer = require('./source-map-consumer').SourceMapConsumer;
  var BasicSourceMapConsumer = require('./basic-source-map-consumer').BasicSourceMapConsumer;

  /**
   * An IndexedSourceMapConsumer instance represents a parsed source map which
   * we can query for information. It differs from BasicSourceMapConsumer in
   * that it takes "indexed" source maps (i.e. ones with a "sections" field) as
   * input.
   *
   * The only parameter is a raw source map (either as a JSON string, or already
   * parsed to an object). According to the spec for indexed source maps, they
   * have the following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - file: Optional. The generated file this source map is associated with.
   *   - sections: A list of section definitions.
   *
   * Each value under the "sections" field has two fields:
   *   - offset: The offset into the original specified at which this section
   *       begins to apply, defined as an object with a "line" and "column"
   *       field.
   *   - map: A source map definition. This source map could also be indexed,
   *       but doesn't have to be.
   *
   * Instead of the "map" field, it's also possible to have a "url" field
   * specifying a URL to retrieve a source map from, but that's currently
   * unsupported.
   *
   * Here's an example source map, taken from the source map spec[0], but
   * modified to omit a section which uses the "url" field.
   *
   *  {
   *    version : 3,
   *    file: "app.js",
   *    sections: [{
   *      offset: {line:100, column:10},
   *      map: {
   *        version : 3,
   *        file: "section.js",
   *        sources: ["foo.js", "bar.js"],
   *        names: ["src", "maps", "are", "fun"],
   *        mappings: "AAAA,E;;ABCDE;"
   *      }
   *    }],
   *  }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.535es3xeprgt
   */
  function IndexedSourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sections = util.getArg(sourceMap, 'sections');

    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    var lastOffset = {
      line: -1,
      column: 0
    };
    this._sections = sections.map(function (s) {
      if (s.url) {
        // The url field will require support for asynchronicity.
        // See https://github.com/mozilla/source-map/issues/16
        throw new Error('Support for url field in sections not implemented.');
      }
      var offset = util.getArg(s, 'offset');
      var offsetLine = util.getArg(offset, 'line');
      var offsetColumn = util.getArg(offset, 'column');

      if (offsetLine < lastOffset.line ||
          (offsetLine === lastOffset.line && offsetColumn < lastOffset.column)) {
        throw new Error('Section offsets must be ordered and non-overlapping.');
      }
      lastOffset = offset;

      return {
        generatedOffset: {
          // The offset fields are 0-based, but we use 1-based indices when
          // encoding/decoding from VLQ.
          generatedLine: offsetLine + 1,
          generatedColumn: offsetColumn + 1
        },
        consumer: new SourceMapConsumer(util.getArg(s, 'map'))
      }
    });
  }

  IndexedSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
  IndexedSourceMapConsumer.prototype.constructor = SourceMapConsumer;

  /**
   * The version of the source mapping spec that we are consuming.
   */
  IndexedSourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(IndexedSourceMapConsumer.prototype, 'sources', {
    get: function () {
      var sources = [];
      for (var i = 0; i < this._sections.length; i++) {
        for (var j = 0; j < this._sections[i].consumer.sources.length; j++) {
          sources.push(this._sections[i].consumer.sources[j]);
        }
      };
      return sources;
    }
  });

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
  IndexedSourceMapConsumer.prototype.originalPositionFor =
    function IndexedSourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      // Find the section containing the generated position we're trying to map
      // to an original position.
      var sectionIndex = binarySearch.search(needle, this._sections,
        function(needle, section) {
          var cmp = needle.generatedLine - section.generatedOffset.generatedLine;
          if (cmp) {
            return cmp;
          }

          return (needle.generatedColumn -
                  section.generatedOffset.generatedColumn);
        });
      var section = this._sections[sectionIndex];

      if (!section) {
        return {
          source: null,
          line: null,
          column: null,
          name: null
        };
      }

      return section.consumer.originalPositionFor({
        line: needle.generatedLine -
          (section.generatedOffset.generatedLine - 1),
        column: needle.generatedColumn -
          (section.generatedOffset.generatedLine === needle.generatedLine
           ? section.generatedOffset.generatedColumn - 1
           : 0)
      });
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * available.
   */
  IndexedSourceMapConsumer.prototype.sourceContentFor =
    function IndexedSourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];

        var content = section.consumer.sourceContentFor(aSource, true);
        if (content) {
          return content;
        }
      }
      if (nullOnMissing) {
        return null;
      }
      else {
        throw new Error('"' + aSource + '" is not in the SourceMap.');
      }
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
  IndexedSourceMapConsumer.prototype.generatedPositionFor =
    function IndexedSourceMapConsumer_generatedPositionFor(aArgs) {
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];

        // Only consider this section if the requested source is in the list of
        // sources of the consumer.
        if (section.consumer.sources.indexOf(util.getArg(aArgs, 'source')) === -1) {
          continue;
        }
        var generatedPosition = section.consumer.generatedPositionFor(aArgs);
        if (generatedPosition) {
          var ret = {
            line: generatedPosition.line +
              (section.generatedOffset.generatedLine - 1),
            column: generatedPosition.column +
              (section.generatedOffset.generatedLine === generatedPosition.line
               ? section.generatedOffset.generatedColumn - 1
               : 0)
          };
          return ret;
        }
      }

      return {
        line: null,
        column: null
      };
    };

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  IndexedSourceMapConsumer.prototype._parseMappings =
    function IndexedSourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      this.__generatedMappings = [];
      this.__originalMappings = [];
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];
        var sectionMappings = section.consumer._generatedMappings;
        for (var j = 0; j < sectionMappings.length; j++) {
          var mapping = sectionMappings[i];

          var source = mapping.source;
          var sourceRoot = section.consumer.sourceRoot;

          if (source != null && sourceRoot != null) {
            source = util.join(sourceRoot, source);
          }

          // The mappings coming from the consumer for the section have
          // generated positions relative to the start of the section, so we
          // need to offset them to be relative to the start of the concatenated
          // generated file.
          var adjustedMapping = {
            source: source,
            generatedLine: mapping.generatedLine +
              (section.generatedOffset.generatedLine - 1),
            generatedColumn: mapping.column +
              (section.generatedOffset.generatedLine === mapping.generatedLine)
              ? section.generatedOffset.generatedColumn - 1
              : 0,
            originalLine: mapping.originalLine,
            originalColumn: mapping.originalColumn,
            name: mapping.name
          };

          this.__generatedMappings.push(adjustedMapping);
          if (typeof adjustedMapping.originalLine === 'number') {
            this.__originalMappings.push(adjustedMapping);
          }
        };
      };

    this.__generatedMappings.sort(util.compareByGeneratedPositions);
    this.__originalMappings.sort(util.compareByOriginalPositions);
  };

  exports.IndexedSourceMapConsumer = IndexedSourceMapConsumer;
});

},{"./basic-source-map-consumer":36,"./binary-search":37,"./source-map-consumer":40,"./util":43,"amdefine":1}],39:[function(require,module,exports){
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

},{"./util":43,"amdefine":1}],40:[function(require,module,exports){
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

  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    // We do late requires because the subclasses require() this file.
    if (sourceMap.sections != null) {
      var indexedSourceMapConsumer = require('./indexed-source-map-consumer');
      return new indexedSourceMapConsumer.IndexedSourceMapConsumer(sourceMap);
    } else {
      var basicSourceMapConsumer = require('./basic-source-map-consumer');
      return new basicSourceMapConsumer.BasicSourceMapConsumer(sourceMap);
    }
  }

  SourceMapConsumer.fromSourceMap = function(aSourceMap) {
    var basicSourceMapConsumer = require('./basic-source-map-consumer');
    return basicSourceMapConsumer.BasicSourceMapConsumer
            .fromSourceMap(aSourceMap);
  }

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;


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
      throw new Error("Subclasses must implement _parseMappings");
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
      // When there is no exact match, BasicSourceMapConsumer.prototype._findMapping
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

  exports.SourceMapConsumer = SourceMapConsumer;

});

},{"./basic-source-map-consumer":36,"./indexed-source-map-consumer":38,"./util":43,"amdefine":1}],41:[function(require,module,exports){
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

},{"./array-set":33,"./base64-vlq":34,"./mapping-list":39,"./util":43,"amdefine":1}],42:[function(require,module,exports){
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

},{"./source-map-generator":41,"./util":43,"amdefine":1}],43:[function(require,module,exports){
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

},{"amdefine":1}],44:[function(require,module,exports){

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

},{}],45:[function(require,module,exports){

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
	options.functionName = userOptions.functionName || 'lio';
	options.runtimeLib = userOptions.runtimeLib || '_lio';
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
			if (message.getSymbolValue() !== ":=" && message.getSymbolValue() !== "=") continue;

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

			var updateSlot = new ast.Message(
				new ast.Symbol(
					new ast.Literal('identifier', 'updateSlot'),
					[[assignmentSlot], [rhs]]
				));

			if (message.getSymbolValue() == ":=")
				chain.setMessages(beforeThose.concat([target, setSlot]));
			else
				chain.setMessages(beforeThose.concat([target, updateSlot]));
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

},{"./ast":44,"./parser":47,"./pratt":48,"ast-types":21,"escodegen":23}],46:[function(require,module,exports){
var _lio = (function () {

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
			slot = unwrapIoValue(slot);
			if (this.slots[slot]) {
				this.slots[slot] = value;
				return this.slots[slot];		
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
		"%": function (other) {
			return IoNumberWrapper(unwrapIoValue(this) % unwrapIoValue(other));
		},
		">": function (other) {
			return IoBooleanWrapper(unwrapIoValue(this) > unwrapIoValue(other));
		},	
		"<": function (other) {
			return IoBooleanWrapper(unwrapIoValue(this) < unwrapIoValue(other));
		},		
		"==": function (other) {
			return IoBooleanWrapper(unwrapIoValue(this) === unwrapIoValue(other));
		},
		toIoString: function () {
			return IoStringWrapper(unwrapIoValue(this));
		}
	}, IoRootObject);

	var IoList = IoObject({
		type: 'List',
		list: function () {
			var value = [];
			for (var i = 0; i < arguments.length; i++) {
    			value.push(arguments[i]);
  			}
			return IoListWrapper(value);
		},
		size: function () {
    		return IoNumberWrapper(unwrapIoValue(this).length);
		},
		append: function (other) {
    		return IoListWrapper(unwrapIoValue(this).push(other));
		},		
		"at": function (other) {
			return unwrapIoValue(this)[unwrapIoValue(other)];
		},
		toIoString: function () {
			return IoStringWrapper(unwrapIoValue(this));
		}
	}, IoRootObject);


	function IoListWrapper (value) {
		return IoObject({value: value}, IoList);
	}

	function IoListWrapperEachElement (value) {
		for (index = 0; index < value.length; ++index) {
    		value[index] = wrapJSValue(value[index])
		}
		return IoObject({value: value}, IoList);
	}

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
		"split": function (other) {
			if (other)
			{
				return IoListWrapperEachElement(unwrapIoValue(this).split(unwrapIoValue(other)));	
			}
			else
			{
				return IoListWrapperEachElement(unwrapIoValue(this).split(" "));
			}
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
	Lobby.slots['List'] = IoList;
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
		case 'List':
			return ioValue.slots.value;
		case 'Block':
			// To wrap a block, we wrap it in a function which
			// activates the original Io method when applied.
			// The appropriate Io context is kept.

			return function () {
				var args = Array.prototype.slice.call(arguments).map(_lio.wrapJSValue);
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
						args = args.map(_lio.unwrapIoValue);
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
		IoList: IoList,
		IoRootObject: IoRootObject,
		getTypeOf: getTypeOf,
		unwrapIoValue: unwrapIoValue,
		wrapJSValue: wrapJSValue,
		Proxy: Proxy,
	};
})();

if (typeof module !== 'undefined' && module.exports) {
	module.exports = _lio;
}

},{}],47:[function(require,module,exports){
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
}).call(this,require('_process'))
},{"./ast":44,"_process":31,"fs":22,"path":30}],48:[function(require,module,exports){

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
},{"./ast":44}],"lio":[function(require,module,exports){

var compile = require('./src/compile');
var lib = require('./src/lib');
var _lio = lib;

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

},{"./src/compile":45,"./src/lib":46}]},{},[]);
