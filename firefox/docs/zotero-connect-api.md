Zotero Connector HTTP Server

Zotero has a built-in HTTP server to communicate with the Zotero Connector browser extensions.

The connector server defines several endpoints by default, including:

    /connector/savePage
    /connector/saveItems
    /connector/saveSnapshot
    /connector/selectItems
    /connector/getTranslatorCode
    /connector/ping

These endpoints are implemented in server_connector.js. The server is implemented in server.js.
Extending the Connector Server

The following code registers an additional endpoint with the connector server.

This script must be run with chrome privileges. The best way to do this is to create an extension that registers an XPCOM service to run at Zotero startup. This can (and should if possible) be a bootstrapped extension. Alternatively, you could register the endpoint from a overlay or from a chrome URI that you load manually.

Once registered, going to http://127.0.0.1:23119/myAddon/helloWorld in a web browser should produce a page containing “Hello world.”

When the server receives a request for a given endpoint, it calls the init() method of the specified object, passing two arguments:

    data - the query string (for a GET request) or POST data (for a POST request)
    sendResponseCallback - a function to send a response to the HTTP request. This can be passed a response code alone (e.g., sendResponseCallback(404)) or a response code, MIME type, and response body (e.g., sendResponseCallback(200, “text/plain”, “Hello World!”))

The endpoint can also restrict supported methods and data types. Keep in mind that any webpage loaded in a browser can issue a GET request or POST application/x-www-urlencoded or text/plain encoded data to the integrated HTTP server, although cross-origin restrictions prevent webpages from reading the response.

var Zotero = Components.classes["@zotero.org/Zotero;1"]
.getService(Components.interfaces.nsISupports)
.wrappedJSObject;

/\*\*

- Hello world endpoint
-
- Accepts:
-     Nothing
- Returns:
-     "Hello world" page
  \*/
  var myEndpoint = Zotero.Server.Endpoints["/myAddon/helloWorld"] = function() {};
  myEndpoint.prototype = {
  "supportedMethods":["GET"],
      /**
       * Sends a fixed webpage
       * @param {String} data POST data or GET query string
       * @param {Function} sendResponseCallback function to send HTTP response
       */
      "init":function(postData, sendResponseCallback) {
      	sendResponseCallback(200, "text/html",
      		'<!DOCTYPE html><html><head/><body>Hello world!</body></html>');
      }
  }
