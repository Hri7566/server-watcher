import express, { Express } from "express";
import https from 'https';
import http from 'http';
import YAML from 'yaml';
import net from 'net';
import { readFile, readFileSync } from "fs";
import { resolve } from "path";
import URL from 'url';
import chokidar from 'chokidar';

require('dotenv').config();

const checkPort = (host: string, port: number, timeout: number): Promise<boolean> => {
    return new Promise<boolean>((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);

        socket.once('error', () => {
            socket.end();
            resolve(false);
        });

        socket.once('timeout', () => {
            socket.end();
            resolve(false);
        });

        socket.connect({
            port, host
        }, () => {
            socket.end();
            resolve(true);
        });
    });
}

const envIsTrue = (envvar: string) => {
    return envvar === 'true' || envvar === '1';
}

const envInt = (envvar: string) => {
    let int = parseInt(envvar);
    if (isNaN(int)) return null;
    return int;
}

const usingTLS = envIsTrue(process.env.TLS as string);
const TLSdir = process.env.TLS_DIR || resolve(__dirname, '../ssl/');
const serverPort: number = envInt(process.env.PORT as string) || 3050;
const serverHost: string = process.env.HOST || '127.0.0.1';

interface ServerConfig {
    uri: string;
}

interface ServerInfo {
    uri: string;
    up: boolean;
}

class Server {
    public static app: Express;
    public static serverInfoList: ServerInfo[] = [];
    public static servers: ServerConfig[] = [];
    public static checkInterval: NodeJS.Timer;
    public static httpServer: http.Server | https.Server;

    public static start(configs: ServerConfig[], key?: string, cert?: string): void {
        for (let server of configs) {
            this.addServer(server);
        }

        this.checkInterval = setInterval(() => {
            this.checkServers();
        }, 10000);

        this.checkServers();
        this.app = express();
        
        if (key && cert) {
            this.httpServer = https.createServer({ key, cert }, this.app);
        } else {
            this.httpServer = http.createServer(this.app);
        }
        
        this.setupRoutes();
        this.listen();
    }
    
    private static setupRoutes(): void {
        this.app.get('/', (req, res) => {
            res.json(this.serverInfoList);
        });
    }

    private static listen(): void {
        this.httpServer.listen(serverPort, serverHost, 32, () => {
            console.log('Server started on port ' + serverPort);
        });
    }

    public static addServer(serverConfig: ServerConfig) {
        this.servers.push(serverConfig);
    }

    private static async checkServers() {
        for (let server of this.servers) {
            let uri = URL.parse(server.uri);
            if (!uri.hostname || !uri.port) continue;
            let result = await checkPort(uri.hostname, parseInt(uri.port), 10000);
            // console.log(uri.hostname, uri.port, result);
            this.setUp(server.uri, result);
        }
    }

    private static setUp(uri: string, val: boolean) {
        const info = this.serverInfoList.find(s => s.uri == uri);
        
        if (!info) {
            this.serverInfoList.push({
                uri, up: val
            } as ServerInfo);
        } else {
            info.up = val;
        }
    }

    public static reloadConfig(configs: ServerConfig[]) {
        this.servers = [];

        for (let server of configs) {
            this.addServer(server);
        }
    }
}

let configFile = readFileSync(resolve(__dirname, '../config.yml'));
let config = YAML.parse(configFile.toString());

if (usingTLS) {
    const key = readFileSync(resolve(TLSdir, 'key.pem')).toString();
    const cert = readFileSync(resolve(TLSdir, 'cert.pem')).toString();

    Server.start(config.servers, key, cert);
} else {
    Server.start(config.servers);
}

let watcher = chokidar.watch('./config.yml');

watcher.on('change', () => {
    let configFile = readFileSync(resolve(__dirname, '../config.yml'));
    let config = YAML.parse(configFile.toString());
    Server.reloadConfig(config.servers);
});
