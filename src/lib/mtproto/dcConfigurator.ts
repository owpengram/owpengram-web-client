/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import MTTransport, {MTConnectionConstructable} from '@lib/mtproto/transports/transport';
import Modes from '@config/modes';
import {OWPENGRAM_SECURE, OWPENGRAM_SERVER} from '@config/owpengram';
import indexOfAndSplice from '@helpers/array/indexOfAndSplice';
import HTTP from '@lib/mtproto/transports/http';
import Socket from '@lib/mtproto/transports/websocket';
import TcpObfuscated from '@lib/mtproto/transports/tcpObfuscated';
import {IS_WEB_WORKER} from '@helpers/context';
import {DcId} from '@types';
import {getEnvironment} from '@environment/utils';
import SocketProxied from '@lib/mtproto/transports/socketProxied';

export type TransportType = 'websocket' | 'https' | 'http';
export type ConnectionType = 'client' | 'download' | 'upload';
type Servers = {
  [transportType in TransportType]: {
    [connectionType in ConnectionType]: {
      [dcId: DcId]: MTTransport[]
    }
  }
};

const TEST_SUFFIX = Modes.test ? '_test' : '';
const PREMIUM_SUFFIX = '_premium';
const RETRY_TIMEOUT_CLIENT = 3000;
const RETRY_TIMEOUT_DOWNLOAD = 3000;

// A dcId can arrive from the service worker's `stream/` route, i.e. from a URL any page
// can craft: interpolated unchecked it turns the endpoint into an attacker-chosen host
// (`1.evil.com/` -> wss://kws1.evil.com/-1.web.telegram.org/apiws). Telegram has exactly
// five DCs, so validate here, before the value can reach a URL or a storage key.
//
// Still enforced even though the dcId no longer reaches the URL at all (every DC
// resolves to OWPENGRAM_SERVER): it also keys stored auth keys, and the five-DC
// range is what the rest of the client and the server's own dc_options assume.
export function assertValidDcId(dcId: DcId): DcId {
  const id = +dcId;
  if(!Number.isInteger(id) || id < 1 || id > 5) {
    throw new Error('[MT] invalid dcId: ' + dcId);
  }

  return id as DcId;
}

export function constructTelegramWebSocketUrl(_dcId: DcId, connectionType: ConnectionType, premium?: boolean) {
  if(!import.meta.env.VITE_MTPROTO_HAS_WS) {
    return;
  }

  assertValidDcId(_dcId);
  // No per-DC subdomain and no connection-type suffix in the host, unlike
  // Telegram's `kws{dc}{-1}.web.telegram.org`: one server answers for every DC
  // and every connection type. The path still varies, because that is what the
  // server routes on -- its allowlist is exactly apiws{_test}{_premium}.
  const path = 'apiws' + TEST_SUFFIX + (connectionType !== 'client' && premium ? PREMIUM_SUFFIX : '');
  const chosenServer = `${OWPENGRAM_SECURE ? 'wss' : 'ws'}://${OWPENGRAM_SERVER}/${path}`;

  return chosenServer;
}

export class DcConfigurator {
  // Every DC is the same machine, so this replaces both Telegram's hardcoded
  // DC IPs and the pluto/venus/... ssl subdomains the https transport derived
  // its host from.
  private dcOptions = (() => {
    const [host, port] = OWPENGRAM_SERVER.split(':');
    return [1, 2, 3, 4, 5].map((id) => ({id, host, port: +port || 80}));
  })();

  public chosenServers: Servers = {} as any;

  private transportSocket = (dcId: DcId, connectionType: ConnectionType, premium?: boolean) => {
    if(!import.meta.env.VITE_MTPROTO_HAS_WS) {
      return;
    }

    const chosenServer = constructTelegramWebSocketUrl(dcId, connectionType, premium);
    const logSuffix = connectionType === 'upload' ? '-U' : connectionType === 'download' ? '-D' : '';

    const retryTimeout = connectionType === 'client' ? RETRY_TIMEOUT_CLIENT : RETRY_TIMEOUT_DOWNLOAD;

    let oooohLetMeLive: MTConnectionConstructable;
    if(import.meta.env.VITE_MTPROTO_SW || !import.meta.env.VITE_SAFARI_PROXY_WEBSOCKET) {
      oooohLetMeLive = Socket;
    } else {
      oooohLetMeLive = (getEnvironment().IS_SAFARI && IS_WEB_WORKER && typeof(SocketProxied) !== 'undefined') /* || true */ ? SocketProxied : Socket;
    }

    return new TcpObfuscated(oooohLetMeLive, dcId, chosenServer, logSuffix, retryTimeout);
  };

  private transportHTTP = (dcId: DcId, connectionType: ConnectionType, premium?: boolean) => {
    if(!import.meta.env.VITE_MTPROTO_HAS_HTTP) {
      return;
    }

    let chosenServer: string;
    if(Modes.ssl || !Modes.http) {
      const path = Modes.test ? 'apiw_test1' : 'apiw1';
      chosenServer = (OWPENGRAM_SECURE ? 'https://' : 'http://') + OWPENGRAM_SERVER + '/' + path;
    } else {
      for(const dcOption of this.dcOptions) {
        if(dcOption.id === dcId) {
          chosenServer = 'http://' + dcOption.host + (dcOption.port !== 80 ? ':' + dcOption.port : '') + '/apiw1';
          break;
        }
      }
    }

    const logSuffix = connectionType === 'upload' ? '-U' : connectionType === 'download' ? '-D' : '';
    return new HTTP(dcId, chosenServer, logSuffix);
  };

  public chooseServer(
    dcId: DcId,
    connectionType: ConnectionType = 'client',
    transportType: TransportType = Modes.transport,
    reuse = true,
    premium?: boolean
  ) {
    /* if(transportType === 'websocket' && !Modes.multipleConnections) {
      connectionType = 'client';
    } */

    dcId = assertValidDcId(dcId);

    if(!this.chosenServers.hasOwnProperty(transportType)) {
      this.chosenServers[transportType] = {
        client: {},
        download: {},
        upload: {}
      };
    }

    const servers = this.chosenServers[transportType][connectionType];

    if(!(dcId in servers)) {
      servers[dcId] = [];
    }

    const transports = servers[dcId];

    if(!transports.length || !reuse/*  || (upload && transports.length < 1) */) {
      let transport: MTTransport;

      if(import.meta.env.VITE_MTPROTO_HAS_WS && import.meta.env.VITE_MTPROTO_HAS_HTTP) {
        transport = (transportType === 'websocket' ? this.transportSocket : this.transportHTTP)(dcId, connectionType, premium);
      } else if(!import.meta.env.VITE_MTPROTO_HTTP) {
        transport = this.transportSocket(dcId, connectionType, premium);
      } else {
        transport = this.transportHTTP(dcId, connectionType, premium);
      }

      if(!transport) {
        console.error('No chosenServer!', dcId);
        return null;
      }

      if(reuse) {
        transports.push(transport);
      }

      return transport;
    }

    return transports[0];
  }

  public static removeTransport<T>(obj: any, transport: T) {
    for(const transportType in obj) {
      // @ts-ignore
      for(const connectionType in obj[transportType]) {
        // @ts-ignore
        for(const dcId in obj[transportType][connectionType]) {
          // @ts-ignore
          const transports: T[] = obj[transportType][connectionType][dcId];
          indexOfAndSplice(transports, transport);
        }
      }
    }
  }
}
