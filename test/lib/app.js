import Koa from 'koa';
import convert from 'koa-convert';
import session from 'koa-generic-session';
import bodyParser from 'koa-bodyparser';
import cookie from 'koa-cookie';

const app = new Koa();
app.keys = [ 'wapstatic', 'mxd' ];
app.use(cookie('here is some secret'));
app.use(session({
  key: 'SESSIONID', // default "koa:sess"
  store: session.MemoryStore(),
}));
app.use(convert(bodyParser()));
module.exports = app;
