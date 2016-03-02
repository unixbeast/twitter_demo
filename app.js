var express = require('express');
var session = require('express-session');
var querystring = require('querystring');
var request = require('request');
var config = require('config');
var SmartThings = require('./lib/st-oauth');

var app = express();
app.use(session({secret: 'dfghlkj34h5lkjsadfkj', resave: false,
  saveUninitialized: false}));

var stClient = new SmartThings(config.get('OAuth.client-id'),
  config.get('OAuth.client-secret'), 'http://localhost:3000/smartthings/callback');

  // home page
  // if no access token or base_uri exist in the current session, redirects to authorize.
  // otherwise redirects to the switches route
  app.get('/', function(req, res) {
    if (!req.session.token || !req.session.base_uri) {
      console.log('No token or base_uri exists in session, redirect to authorize');
      res.redirect('/authorize');
    } else {
      console.log('token and base_uri exist, will redirect to see switches');
      res.redirect('/switches');
    }
  });

  // Displays link to authorize with SmartThings
  app.get('/authorize', function(req, res) {
    var action =  (req.query.action && req.query.action != "")
      ? "?action="+querystring.escape(req.query.action) : "";
    console.log('action in authorize: ' + action);
    var href="/auth" + action;
    res.send('Hello<br><a href='+href+'>Log in with SmartThings</a>');
  });

  // builds SmartThigns Authorization URL and redirects user to it, where they
  // will select devices to authorize and begin the OAuth2 flow.
  app.get('/auth', function(req, res) {
    var action =  (req.query.action && req.query.action != "")
      ? "?action="+querystring.escape(req.query.action) : "";
    console.log('action to pass along: ' + action);
    var authUrl = stClient.getAuthUrl(action);
    console.log('will redirect to: ' + authUrl);
    res.redirect(authUrl);
  });

  // callback that ST will call with token
  // will store the token and base_uri that the SmartApp can be reached at in the current session.
  app.get('/smartthings/callback', function(req, res) {
    var tokenResponse = stClient.getAccessToken(req.query.code,
      function(error, tokenInfo, smartAppUri) {
        if (error) {
          res.send('Error authenticating with SmartThings');
        } else {
          console.log('tokenInfo: ' + JSON.stringify(tokenInfo));
          console.log('endpointUri: ' + smartAppUri);
          req.session.token = tokenInfo;
          req.session.base_uri = smartAppUri;

          // todo - store action in request and use it instead of hard-coding
          res.redirect((req.query.action && req.query.action != "") ?
            req.query.action : "/switches");
        }

      }
    );
  });

  // middleware to ensure that a token exists and is still valid
  // (doesn't need to be refreshed). Will proceed if the token exists and is
  // valid, and redirect to authorize if not.
  function require_st_auth(req, res, next) {
    if (!req.session.token || !req.session.base_uri) {
      console.log('token or base_uri is not in the session, redirecting to ' +
        'authorize');
      var redirectUrl = '/authorize?action='+querystring.escape(req.originalUrl);
      console.log('will redirect to: ' + redirectUrl);
      res.redirect(redirectUrl);
      return;
    } else if (stClient.tokenNeedsRefresh(req.session.token, 0)) {
      stClient.refreshToken(req.session.token.refresh_token, function(err, resp) {
        if (err) {
          console.error('could not refresh token, redirecting to authorize');
          res.redirect('/authorize');
          return;
        } else {
          console.log('got refresh token, will continue');
          req.session.token = resp;
          next();
        }
      })
    } else {
      // have token, doesn't need refreshing. Proceed!
      next();
    }
  }

  // display switch status
  // uses require_st_auth middleware to check that access token is available
  // and valid
  app.get('/switches', require_st_auth, function(req, res) {
    stClient.get({
      token: req.session.token.access_token,
      uri: req.session.base_uri + '/switches'
    }, function(error, resp, body) {
      // todo - need custom errors, this is horrible
      // error may be null from service, so doing this for now
      if (error || resp.statusCode == 500) {
        res.send('There was error getting your configured switches.');
      } else {
        console.log('got switch body: ' + body);
        res.set('Content-Type', 'application/json');
        res.send('Switches: ' + body);
      }
    });
  });

  app.get('/update-switches', require_st_auth, function(req, res) {
    stClient.post({
      token: req.session.token.access_token,
      uri: req.session.base_uri + '/switches/on'
    }, function(error, resp, body) {
      if (error) {
        res.send('There was an error updating the switches');
      } else {
        console.log('got response body: ' + body);
        res.send('Result of update: ' + body);
      }
    });
  });

  // handle 404
  app.use(function(req, res) {
    res.type('text/plain');
    res.status(404);
    res.send('404 - Not Found');
  });

  // handle 500
  app.use(function(err, req, res, next) {
    console.error(err.stack);
    res.type('text/plain');
    res.status(500);
    res.send('500 - Server Error');
  });

  // start er up
  app.listen(3000, function() {
    console.log('Express started on http://localhost:3000; press CTRL-C to ' +
      'terminate.');
  });
