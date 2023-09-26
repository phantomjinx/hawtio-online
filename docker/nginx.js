// http://nginx.org/en/docs/njs
// https://github.com/nginx/njs
// https://github.com/xeioex/njs-examples

import RBAC from 'rbac.js';
import jsyaml from 'js-yaml.js';
import jwt_decode from 'jwt-decode.js';

var fs = require('fs');

RBAC.initACL(jsyaml.safeLoad(fs.readFileSync(process.env['HAWTIO_ONLINE_RBAC_ACL'] || 'ACL.yaml')));

var isRbacEnabled = typeof process.env['HAWTIO_ONLINE_RBAC_ACL'] !== 'undefined';
var useForm = process.env['HAWTIO_ONLINE_AUTH'] === 'form';

export default { proxyJolokiaAgent };

/*
 * Change: [response|request]Body -> [response|request]Text
 * The property was made obsolete in 0.5.0 and was removed in 0.8.0.
 * The r.responseBuffer or the r.responseText property should be used instead.
 */

function proxyJolokiaAgent(req) {
  req.log("=== PROXY JOLOKIA REQUEST ===");
  req.log("Request URL: " + req.uri);

  var parts = req.uri.match(/\/management\/namespaces\/(.+)\/pods\/(http|https):(.+):(\d+)\/(.*)/);
  if (!parts) {
    req.return(404);
    return;
  }
  var namespace = parts[1];
  var protocol = parts[2];
  var pod = parts[3];
  var port = parts[4];
  var path = parts[5];

  req.log(`NAMESPACE: ${namespace}`)
  req.log(`PROTOCOL: ${protocol}`)
  req.log(`POD: ${pod}`)
  req.log(`PORT: ${port}`)
  req.log(`PATH: ${path}`)

  function jsonResponse(res) {
    req.log("==== jsonResponse ====")
    let payload = {}
    if (res && res.responseText) {
      payload = res.responseText
    }

    req.log('Parsing the payload: ' + payload)
    const resBody = JSON.parse(payload)
    req.log('Successfully parsed body')
    return resBody
  }

  function response(res) {
    req.log("==== response ====")
    req.log(`PGR1 response: status=${res.status}`);

    if (res.headersOut) {
      for (var header in res.headersOut) {
        req.headersOut[header] = res.headersOut[header];
      }
    }

    req.log("The response: ");
    req.return(res.status, res.responseText);
  }

  function reject(status, message) {
    req.log("==== reject ====")
    return Promise.reject({
      status: status,
      responseBody: message,
      headersOut: {
        'Content-Type': 'application/json',
      }
    });
  }

  function getSubjectFromJwt() {
    req.log("==== getSubjectFromJwt ====")
    var authz = req.headersIn['Authorization'];
    if (!authz) {
      req.error('Authorization header not found in request');
      return '';
    }
    var token = authz.split(' ')[1];
    var payload = jwt_decode(token);
    return payload.sub;
  }

  function selfLocalSubjectAccessReview(verb) {
    req.log("==== selfLocalSubjectAccessReview ====")
    var api;
    var body;
    // When form is used, don't rely on OpenShift-specific LocalSubjectAccessReview
    if (useForm) {
      api = "authorization.k8s.io";
      body = {
        kind: 'LocalSubjectAccessReview',
        apiVersion: 'authorization.k8s.io/v1',
        metadata: {
          namespace: namespace,
        },
        spec: {
          user: getSubjectFromJwt(),
          resourceAttributes: {
            verb: verb,
            resource: 'pods',
            name: pod,
            namespace: namespace,
          }
        }
      };
    } else {
      api = "authorization.openshift.io";
      body = {
        kind: 'LocalSubjectAccessReview',
        apiVersion: 'authorization.openshift.io/v1',
        namespace: namespace,
        verb: verb,
        resource: 'pods',
        resourceName: pod,
      };
    }
    var json = JSON.stringify(body);
    req.log(`selfLocalSubjectAccessReview(${verb}): ${api} - ${json}`);

    // Work-around same-location sub-requests caching issue
    var suffix = verb === 'get' ? '2' : '';

    req.log(`SubRequest: /authorization${suffix}/${api}/namespaces/${namespace}/localsubjectaccessreviews}`)
    req.log(`Body: ${json}`)

    return req.subrequest(`/authorization${suffix}/${api}/namespaces/${namespace}/localsubjectaccessreviews`, {
      method: 'POST',
      body: json
    });
  }

  function getPodIP() {
    req.log("==== getPodIP ====")
    return req.subrequest(`/podIP/${namespace}/${pod}`, { method: 'GET' }).then(res => {
      req.log(`getPodIP(${namespace}/${pod}): status=${res.status}`);

      if (res.status !== 200) {
        return Promise.reject(res);
      }
      return jsonResponse(res).status.podIP;
    });
  }

  // This is usually called once upon the front-end loads, still we may want to cache it
  function listMBeans(podIP) {
    req.log("==== listMBeans ====")
    return req.subrequest(`/proxy/${protocol}:${podIP}:${port}/${path}`, { method: 'POST', body: JSON.stringify({ type: 'list' }) }).then(res => {
      if (res.status !== 200) {
        return Promise.reject(res);
      }
      return jsonResponse(res).value;
    });
  }

  function callJolokiaAgent(podIP, request) {
    req.log("==== callJolokiaAgent ====")
    var encodedPath = encodeURI(path);
    req.log(`callJolokiaAgent: ${req.method} /proxy/${protocol}:${podIP}:${port}/${encodedPath}`);
    if (req.method === 'GET') {
      req.log("GET callJolokiaAgent")
      return req.subrequest(`/proxy/${protocol}:${podIP}:${port}/${encodedPath}`);
    } else {
      req.log("OTHER callJolokiaAgent")
      return req.subrequest(`/proxy/${protocol}:${podIP}:${port}/${encodedPath}`, { method: req.method, body: request });
    }
  }

  function proxyJolokiaAgentWithoutRbac() {
    req.log("==== proxyJolokiaAgentWithoutRbac ====")
    // Only requests impersonating a user granted the `update` verb on for the pod
    // hosting the Jolokia endpoint is authorized
    return selfLocalSubjectAccessReview('update')
      .then(res => {
        req.log(`proxyJolokiaAgentWithoutRbac(update): status=${res.status}`);

        if (res.status !== 201) {
          return Promise.reject(res);
        }
        var sar = jsonResponse(res);
        var allowed = useForm ? sar.status.allowed : sar.allowed;
        if (!allowed) {
          return reject(403, JSON.stringify(sar));
        }
        return getPodIP().then(podIP => {
          req.log(`proxyJolokiaAgentWithoutRbac(podIP): podIP=${podIP}`);
          return callJolokiaAgent(podIP, req.requestBody);
        });
      });
  }

  function proxyJolokiaAgentWithRbac() {
    req.log("==== proxyJolokiaAgentWithRbac ====")
    return selfLocalSubjectAccessReview('update')
      .then(res => {
        req.log(`proxyJolokiaAgentWithRbac(update): status=${res.status}`);

        if (res.status !== 201) {
          return Promise.reject(res);
        }

        req.log(`proxyJolokiaAgentWithRbac(update): parsing response body`);
        req.log(`proxyJolokiaAgentWithRbac(update) response: ${res.responseText}`);

        var sar = jsonResponse(res);
        var allowed = useForm ? sar.status.allowed : sar.allowed;
        if (allowed) {
          req.log(`proxyJolokiaAgentWithRbac(update): allowed as admin`);
          // map the `update` verb to the `admin` role
          return 'admin';
        }

        req.log(`proxyJolokiaAgentWithRbac(update): returning selfLocalSubjectAccessReview("get")`);
        return selfLocalSubjectAccessReview('get')
          .then(res => {
            req.log(`proxyJolokiaAgentWithRbac(get): status=${res.status}`);

            if (res.status !== 201) {
              return Promise.reject(res);
            }
            sar = jsonResponse(res);
            allowed = useForm ? sar.status.allowed : sar.allowed;
            if (allowed) {
              // map the `get` verb to the `viewer` role
              return 'viewer';
            }
            return reject(403, JSON.stringify(sar));
          });
      })
      .then((role) => {
        req.log("Handling Request With Role");
        var handler = handleRequestWithRole(role);
        req.log("Completed handling request with role");
        return handler;
      });
  }

  function parseRequest() {
    req.log("==== parseRequest ====")
    if (req.method === 'POST') {
      req.log(`parseRequest: is a POST so parsing requestBody: ${req.requestBody} or maybe should be ${req.requestText}`)
      return JSON.parse(req.requestBody);
    }

    // GET method
    // path: ...jolokia/<type>/<arg1>/<arg2>/...
    // https://jolokia.org/reference/html/protocol.html#get-request
    req.log(`parseRequest: ${req.method} path=${path}`);
    // path is already decoded; no need for decodeURIComponent()
    var match = path.split('?')[0].match(/.*jolokia\/(read|write|exec|search|list|version)\/?(.*)/);
    var type = match[1];
    // Jolokia-specific escaping rules (!*) are not taken care of right now
    switch (type) {
      case 'read':
        // /read/<mbean name>/<attribute name>/<inner path>
        var args = match[2].split('/');
        var mbean = args[0];
        var attribute = args[1];
        // inner-path not supported
        return { type, mbean, attribute };
      case 'write':
        // /write/<mbean name>/<attribute name>/<value>/<inner path>
        var args = match[2].split('/');
        var mbean = args[0];
        var attribute = args[1];
        var value = args[2];
        // inner-path not supported
        return { type, mbean, attribute, value };
      case 'exec':
        // /exec/<mbean name>/<operation name>/<arg1>/<arg2>/....
        var args = match[2].split('/');
        var mbean = args[0];
        var operation = args[1];
        var value = args[2];
        var opArgs = args.slice(2);
        return { type, mbean, operation, arguments: opArgs };
      case 'search':
        // /search/<pattern>
        var mbean = match[2];
        return { type, mbean };
      case 'list':
        // /list/<inner path>
        var innerPath = match[2];
        return { type, path: innerPath };
      case 'version':
        // /version
        return { type };
      default:
        throw `Unexpected Jolokia GET request: ${path}`;
    }
  }

  function handleRequestWithRole(role) {
    req.log("==== handleRequestWithRole ====")
    var request = parseRequest();
    if (req.method === 'GET') {
      req.log(`handleRequestWithRole: ${req.method} request=${JSON.stringify(request)}`);
    }
    var mbeanListRequired;
    if (Array.isArray(request)) {
      mbeanListRequired = request.find(r => RBAC.isMBeanListRequired(r));
      return getPodIP().then(podIP => {
        return (mbeanListRequired ? listMBeans(podIP) : Promise.resolve()).then(mbeans => {
          var rbac = request.map(r => RBAC.check(r, role));
          var intercept = request.filter((_, i) => rbac[i].allowed).map(r => RBAC.intercept(r, role, mbeans));
          var requestBody = JSON.stringify(intercept.filter(i => !i.intercepted).map(i => i.request));
          req.log("inside handling request with role - about to callJolokiaAgent")
          return callJolokiaAgent(podIP, requestBody)
            .then(jolokia => {
              req.log("Post callJolokiaAgent");
              var body = jsonResponse(jolokia);

              req.log("Post callJolokiaAgent: ");
              req.log(body);

              // Unroll intercepted requests
              var bulk = intercept.reduce((res, rbac, i) => {
                if (rbac.intercepted) {
                  res.push(rbac.response);
                } else {
                  res.push(body.splice(0, 1)[0]);
                }
                return res;
              }, []);

              req.log("Unrolled bulk");

              // Unroll denied requests
              bulk = rbac.reduce((res, rbac, i) => {
                if (rbac.allowed) {
                  res.push(bulk.splice(0, 1)[0]);
                } else {
                  res.push({
                    request: request[i],
                    status: 403,
                    reason: rbac.reason,
                  });
                }
                return res;
              }, []);

              req.log("Unrolled denied requests");

              // Re-assembled bulk response
              var response = {
                status: jolokia.status,
                responseBody: JSON.stringify(bulk),
                headersOut: jolokia.headersOut,
              };

              req.log("Expected response: " + response.status)
              req.log(response);

              // Override the content length that changed while re-assembling the bulk response
              response.headersOut['Content-Length'] = response.responseBody.length;
              return response;
            })
            .catch(error => {
              req.log("ERROR ERROR ERROR");
              req.log(error);
              response(error);
            });
        });
      });
    } else {
      mbeanListRequired = RBAC.isMBeanListRequired(request);
      return getPodIP().then(podIP => {
        req.log("Non array called podIP")
        return (mbeanListRequired ? listMBeans(podIP) : Promise.resolve()).then(mbeans => {
          req.log("no mbean list required")
          var rbac = RBAC.check(request, role);
          if (!rbac.allowed) {
            return reject(403, rbac.reason);
          }
          rbac = RBAC.intercept(request, role, mbeans);
          if (rbac.intercepted) {
            return Promise.resolve({ status: rbac.response.status, responseBody: JSON.stringify(rbac.response) });
          }
          req.log("XXX callJolokiaAgent using :" + req.requestBody)
          return callJolokiaAgent(podIP, req.requestBody);
        });
      });
    }
  }

  return (isRbacEnabled ? proxyJolokiaAgentWithRbac() : proxyJolokiaAgentWithoutRbac())
    .then(res => {
      req.log("=== ALL GOOD. RETURNING TO MOTHER SHIP ===");
      return response(res)
    })
    .catch(error => {
      req.log("CATCH AT FOOT OF MAIN NGINX FUNCTION");
      if (error.status) {
        req.log("Catch error at foot of main nginx function: " + error.status);
        req.log(error);
        response(error);
      } else {
        req.log(error);
        req.return(502, new Error('nginx jolokia gateway error', { cause: error}));
      }
    });
}
