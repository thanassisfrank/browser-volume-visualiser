
// a WebSocket wrapper that implements a request-response model with a window.fetch promise equivalent
export class FetchSocket {
    #socket;
    #openWatcher;
    #pending;
    constructor(url, protocols = []) {
        this.#socket = new WebSocket(url, protocols)
        this.#socket.addEventListener("open", this.#openCallBack.bind(this));
        this.#socket.addEventListener("message", this.#msgCallBack.bind(this));
        this.#socket.addEventListener("error", this.#errCallBack.bind(this));
        this.#socket.addEventListener("close", this.#closeCallBack.bind(this));

        // holds resolve and reject handlers for current pending requests
        this.#pending = []
    }

    waitForOpen() {
        return new Promise((resolve, reject) => {
            if (this.#socket === WebSocket.OPEN) {
                resolve();
            } else {
                this.#openWatcher = {resolve, reject}
            } 
        });
    }

    #openCallBack() {
        this.#openWatcher?.resolve();
        this.#openWatcher = undefined;
    }

    // send a message and register a new pending request
    #send(data, resolve, reject) {
        this.#socket.send(data);
        this.#pending.push({resolve, reject})
    }

    #msgCallBack(e) {
        const prom = this.#pending.shift();
        prom.resolve(e.data);
    }

    // calls all of the reject handlers that are pending
    #rejectAll(msg) {
        let prom;
        while (prom = this.#pending.shift()) {
            prom.reject(msg);
        }
        this.#openWatcher?.reject(msg);
        this.#openWatcher = undefined;
    }

    #errCallBack(e) {
        this.#rejectAll(`Socket error: ${e}`)
    }
    
    #closeCallBack(e) {
        this.#rejectAll(`Socket closed: ${e}`)
    }

    // mirrors the 
    fetch(msg) {
        return new Promise((resolve, reject) => {
            // send message
            this.#send(msg, resolve, reject);
        });
    }
}