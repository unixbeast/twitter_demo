var express = require('express');
var session = require('express-session');
var querystring = require('querystring');
var request = require('request');
var config = require('config');
var Twitter = require('twitter');
var SmartThings = require('./lib/st-oauth');

var app = express();

var votes = {red: 0, blue: 0};

var colors = {
    "darkred" : "800000",
    "red" : "FF0000",
    "lightred" : "ff8080",
    "warmwhite" : "ffcccc",
    "white" : "000000",
    "coldwhite" : "ccccff",
    "lightblue" : "8080ff",
    "blue" : "0000ff",
    "darkblue" : "000080"
};

app.use(session({secret: 'dfghlkj34h5lkjsadfkj', resave: false,
  saveUninitialized: false}));
app.set('port', (process.env.PORT || 5000));

var twitterclient = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

var stClient = new SmartThings(config.get('OAuth.client-id'),
  config.get('OAuth.client-secret'), 'http://sttwitterdemo.herokuapp.com/smartthings/callback');

  // home page
  // if no access token or base_uri exist in the current session, redirects to authorize.
  // otherwise redirects to the switches route
  app.get('/', function(req, res) {
    if (!req.session.token || !req.session.base_uri) {
      console.log('No token or base_uri exists in session, redirect to authorize');
      res.redirect('/authorize');
    } else {
      console.log('token and base_uri exist, will redirect to see switches');
      res.redirect('/twitterdemo');
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
    var action =  (req.query.action && (req.query.action != ""))
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
            req.query.action : "/twitterdemo");
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

  var handleVotes = function(req) {
      var redCount = votes.red;
      var blueCount = votes.blue;
      if(redCount > blueCount) {
          stClient.get({
            token: req.session.token.access_token,
            uri: req.session.base_uri + '/setColor/red'
          }, function(error, resp, body) {
            // todo - need custom errors, this is horrible
            // error may be null from service, so doing this for now
            if (error || resp.statusCode == 500) {
              console.log('There was error making the bulb red.');
            }
          });
      } else {
          stClient.get({
            token: req.session.token.access_token,
            uri: req.session.base_uri + '/setColor/blue'
          }, function(error, resp, body) {
            // todo - need custom errors, this is horrible
            // error may be null from service, so doing this for now
            if (error || resp.statusCode == 500) {
              console.log('There was error making the bulb blue.');
            }
          });
      }
  };

  var resetbulb = function() {
      stClient.post({
        token: req.session.token.access_token,
        uri: req.session.base_uri + '/setColor',
        params: {"color", colors.white},
      }, function(error, resp, body) {
        if (error) {
          res.send('There was an error updating the switches');
        } else {
          console.log('got response body: ' + body);
          res.send('Result of update: ' + body);
        }
      });
  };

  // display switch status
  // uses require_st_auth middleware to check that access token is available
  // and valid
  app.get('/twitterdemo', require_st_auth, function(req, res) {
      resetbulb();
      twitterclient.stream('statuses/filter', {track: 'STDaveDemo'}, function(stream) {
          stream.on('data', function(tweet) {
              console.log(tweet.text);
              if(tweet.text.indexOf('red') > -1) {
                  votes.red++;
              }
              if(tweet.text.indexOf('blue') > -1) {
                  votes.blue++;
              }
              handleVotes(req);
          });

          stream.on('error', function(error) {
              throw error;
          });
      });
      res.send('Let\'s do some twitter stuff!<br><a href=\'/votered\'>Red</a><br><a href=\'/voteblue\'>Blue</a>');
  });

  app.get('/votered', require_st_auth, function(req, res) {
      stClient.get({
        token: req.session.token.access_token,
        uri: req.session.base_uri + '/setColor/red'
      }, function(error, resp, body) {
        // todo - need custom errors, this is horrible
        // error may be null from service, so doing this for now
        if (error || resp.statusCode == 500) {
          res.send('There was error.');
        }
      });
      res.redirect('/twitterdemo');
  });

  app.get('/voteblue', require_st_auth, function(req, res) {
      stClient.get({
        token: req.session.token.access_token,
        uri: req.session.base_uri + '/setColor/blue'
      }, function(error, resp, body) {
        // todo - need custom errors, this is horrible
        // error may be null from service, so doing this for now
        if (error || resp.statusCode == 500) {
          res.send('There was error.');
        }
      });
      res.redirect('/twitterdemo');
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
  // app.listen(80, function() {
  //   console.log('Express started on http://sttwitterdemo.herokuapp.com; press CTRL-C to ' +
  //     'terminate.');
  // });
  app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
  });
