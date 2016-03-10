var express = require('express');
var session = require('express-session');
var querystring = require('querystring');
var request = require('request');
var config = require('config');
var Twitter = require('twitter');
var SmartThings = require('./lib/st-oauth');
var http = require("http");

var app = express();

var votes = {red: 0, blue: 0};

var colors = {
    red : "ff0000",
    lightred : "ff3333",
    warmwhite : "ff8080",
    white : "ffffff",
    coldwhite : "8080ff",
    lightblue : "3333ff",
    blue : "0000ff",
};

var twitterInited = false;

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
  config.get('OAuth.client-secret'), process.env.HEROKU_CALLBACK_URL);

  // home page
  // if no access token or base_uri exist in the current session, redirects to authorize.
  // otherwise redirects to the switches route
  app.get('/', function(req, res) {
    if (!req.session.token || !req.session.base_uri) {
      logMessage('No token or base_uri exists in session, redirect to authorize');
      res.redirect('/authorize');
    } else {
      logMessage('token and base_uri exist, will redirect to see twitterdemo');
      if(!twitterInited) {
          logMessage("Initializing Twitter");
          initTwitter(req, res);
      }
      resetbulb(req);
      res.redirect('/twitterdemo');
    }
  });

  // Displays link to authorize with SmartThings
  app.get('/authorize', function(req, res) {
    var action =  (req.query.action && req.query.action != "")
      ? "?action="+querystring.escape(req.query.action) : "";
    logMessage('action in authorize: ' + action);
    var href="/auth" + action;
    res.send('Hello<br><a href='+href+'>Log in with SmartThings</a>');
  });

  // builds SmartThigns Authorization URL and redirects user to it, where they
  // will select devices to authorize and begin the OAuth2 flow.
  app.get('/auth', function(req, res) {
    var action =  (req.query.action && (req.query.action != ""))
      ? "?action="+querystring.escape(req.query.action) : "";
    logMessage('action to pass along: ' + action);
    var authUrl = stClient.getAuthUrl(action);
    logMessage('will redirect to: ' + authUrl);
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
          logMessage('tokenInfo: ' + JSON.stringify(tokenInfo));
          logMessage('endpointUri: ' + smartAppUri);
          req.session.token = tokenInfo;
          req.session.base_uri = smartAppUri;

          // todo - store action in request and use it instead of hard-coding
          if(!twitterInited) {
              logMessage("Initializing Twitter");
              initTwitter(req, res);
          }
          resetbulb(req);
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
      logMessage('token or base_uri is not in the session, redirecting to ' +
        'authorize');
      var redirectUrl = '/authorize?action='+querystring.escape(req.originalUrl);
      logMessage('will redirect to: ' + redirectUrl);
      res.redirect(redirectUrl);
      return;
    } else if (stClient.tokenNeedsRefresh(req.session.token, 0)) {
      stClient.refreshToken(req.session.token.refresh_token, function(err, resp) {
        if (err) {
          console.error('could not refresh token, redirecting to authorize');
          res.redirect('/authorize');
          return;
        } else {
          logMessage('got refresh token, will continue');
          req.session.token = resp;
          next();
        }
      })
    } else {
      // have token, doesn't need refreshing. Proceed!
      next();
    }
  }

  var handleVotes = function(req, res) {
      var redCount = votes.red;
      var blueCount = votes.blue;
      console.log("RED VOTES: " + votes.red + " BLUE VOTES: " + votes.blue);
      if(redCount == blueCount) {
          changeColor(req, colors.white);
      }
      if(redCount > blueCount) {
          var reddifference = redCount - blueCount;
          console.log("RED DIFFERENCE: " + reddifference);
          if(reddifference == 1) {
              changeColor(req, colors.warmwhite);
          } else if(reddifference > 2 && reddifference < 5) {
              changeColor(req, colors.lightred);
          } else if(reddifference > 4) {
              changeColor(req, colors.red);
          }
      }

      if(blueCount > redCount) {
          var bluedifference = blueCount - redCount;
          console.log("BLUE DIFFERENCE: " + bluedifference);
          if(bluedifference == 1) {
              changeColor(req, colors.coldwhite);
          } else if(bluedifference > 2 && bluedifference < 5) {
              changeColor(req, colors.lightblue);
          } else if(bluedifference > 4) {
              changeColor(req, colors.blue);
          }
      }
  };

  var changeColor = function(req, color) {
      stClient.post({
          token: req.session.token.access_token,
          uri: req.session.base_uri + '/setColor',
          params: {color: color},
      }, function(error, resp, body) {
          if (error) {
              console.error('There was and error changing the color of the bulb: ' + error, body);
          }
         }
      );
  }

  var resetbulb = function(req) {
      changeColor(req, colors.white);
      votes = {red: 0, blue: 0};
  };

  var initTwitter = function(req) {
      twitterclient.stream('statuses/filter', {track: process.env.TWITTER_HANDLE}, function(stream) {
          stream.on('data', function(tweet) {
              console.log("INCOMING TWEET FROM: " + tweet.user.name + "(" + tweet.user.screen_name + ") Message: " + tweet.text);
              if(tweet.text.match(/(^|\s)#red\W*(?=\s|$)/g)) {
                  votes.red++;
              }
              if(tweet.text.match(/(^|\s)#blue\W*(?=\s|$)/g)) {
                  votes.blue++;
              }
              handleVotes(req);
          });

          stream.on('error', function(error) {
              throw error;
          });
      });
      twitterInited = true;
  };

  // uses require_st_auth middleware to check that access token is available
  // and valid
  app.get('/twitterdemo', require_st_auth, function(req, res) {
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

  app.listen(app.get('port'), function() {
    logMessage('Node app is running on port', app.get('port'));
  });

  var logMessage = function(message) {
      if(process.env.DEBUG) {
          console.log(message);
      }
  }

//Keep Heroku app awake
setInterval(function() {
    http.get("http://sttwitterdemo.herokuapp.com");
}, 600000); // every 10 minutes (600000)
