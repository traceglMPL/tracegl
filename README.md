TraceGL
=======

TraceGL MPL release (C) Mozilla Corp

Running traceGL unpackaged:
```
git clone git@github.com:/traceglMPL/tracegl.git
cd tracegl
node trace/trace_server.js
```
Packaging tracegl into a single JS file you can copy everywhere (like your home dir)
```
node tools/packer.js trace/trace_server tracegl.js
cp tracegl.js ~/
````
How it works
==
traceGL transforms your JavaScript, injecting monitoring code that produces a log of everything that happens. This log is streamed from the target (node or browser), via the traceGL node.js process to the UI for visualisation. The UI tries to display the resulting huge amount of information fast, and uses webGL to render everything.

Node.js programs
--
````
node ~/tracegl [options] yourprogram.js [arguments]
````
The visualisation UI is available on http://localhost:2000.

Browser JS via static fileserver
--
The built in static fileserver allows traceGL to instrument all the JavaScript files it serves to the browser and gather information. It auto-reloads the site when a file changes so you can live-code with it.

node tracegl [options] ../path/to/wwwroot

Browser JS via proxy
--
Sometimes your JavaScript is delivered by your Rails or Java backend to the browser. In this case you need a man-in-the-middle approach via traceGL's proxy mode. For a Ruby backend on port 3000:

node tracegl [options] http://localhost:3000

Editor integration
--
By doubleclicking on a line in the visualisation UI you can open it in your favorite editor. See the settings for information how to configure this

Commandline options
--
```
node ~/tracegl [options] target [args]
```
target can be 1. a node.js program, 2. a static folder, 3. a proxy target or 4. a gzip file created with -gz to playback.

options can be:

-gz[:trace.gz] Record a trace to gzip file, defaults to trace.gz, doesn't start the UI.

Filtering can be useful to lower the amount of incoming tracedata. Use -do and -no with either a -do:string or a 
-do/regex match. Use double escaped backslashes in regexps (see -nolib).

-do[/:]match Only trace files where filename contains match.

-no[/:]match Don't trace files where filename names contains match.

-nolib Only see your own code. Short for: -no/jquery.* -no:require.js -no/node\\_modules

-noopen Don't try to open the visualisation UI with your default browser

-ui:port Explicitly set the visualisation UI port, default is 2000

-tgt:port Explicitly set the browser JS port, defaults to 2080

-settings Write a settings tracegl.json template in current dir, see settings file

-update Update tracegl.js to the latest version, uses your token to fetch update

Settings file
--
For other settings and commandline defaults traceGL supports a tracegl.json file which it tries to read from the current directory, your home dir, or the directory you store the tracegl.js file (in that order).

Create a template tracegl.json using the -settings command, and then modify these fields:

```
"ui":2000 Set the UI port, -ui:port commandline 
```
```
"tgt":2080 Set the browser JS port, -tgt:port commandline
```
```
"no":[":match"] Takes an array, -no commandline options
```
```
"do":["/regexp"] Takes an array, -do commandline options
```
```
"theme" : "dark" UI Theme, other option: light
```
Editor integration uses a commandline call to your editor, and uses $file and $line to build up the arguments. Put it in the right platform key (darwin, win32, sunos, linux, freebsd). If you have a configuration thats useful, please consider sharing it in a github issue so it can be turned into a default.
```
"bin":"/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl"
"args":["$file:$line"]
```
Issues
--
traceGL cannot instrument JavaScript coming from outside of its reach. For instance if you load jQuery from the google CDN, it cannot visualise that codeflow because it is not delivered by the traceGL proxy or static fileserver. If you keep your JS served through traceGL it should be no problem.
