The file `client-simulation.wiresharked.txt` contains client handshake data manually harvested from a network capture and displayed by wireshark.
testssl.sh uses the file `client-simulation.txt`. Previously we queried the SSLlabs client API via `update_client_sim_data.pl` and added the data into `client-simulation.txt`. For quite some while we don't use the data from SSLlabs anymore as they haven't changed and they are outdated. That reduces the work to editing `client-simulation.wiresharked.txt` and `client-simulation.txt`.

## Instructions how to add a client simulation:

- Start wireshark / tcpdump at a client or router. If it's too noisy better filter for the target of your choice.
- Make sure you create a bit of encrypted traffic to your target. Attention, privacy: if you want to contribute, be aware that the ClientHello contains the target hostname (SNI).
- Make sure the client traffic is specific: For just "Android" do not use an Android browser! Be also careful with factory installed Google Apps, especially on older devices as they might come with a different TLS stack. The play store or e.g. f-droid works.
- Stop recording.
- If needed sort for ClientHello.
- Look for the ClientHello which matches the source IP + destination you had in mind. Check the destination hostname in the SNI extension so that you can be sure it's the right traffic.
- Edit `client-simulation.wiresharked.txt` and insert a new section, preferably by copying a previous version of the client.
- Edit the _names_ accordingly and the _short_ description. The latter must not contain blanks.
- Retrieve _handshakebytes_ by marking the _TLS 1.x Record Layer_ --> Copy --> As a hex stream.
- For _ch_ciphers_: mark _Cipher Suites_ --> Copy --> As a hex stream and supply it to `~/utils/hexstream2cipher.sh`. The last line contains the ciphers which you need to copy. For consistency reasons it is preferred you remove the TLS 1.3 ciphers before which start with TLS\*. . The GREASE "ciphers" (?a?a) which you may see in the very beginning don't show up here.
- _ciphersuites_ are TLS 1.3 ciphersuites which you omitted previously. You can identify them as they currently are normallky like 0x13\*\*. Retrieve them from above see `~/utils/hexstream2cipher.sh`. As said, they start with TLS\*.
- For _curves_ mark the _Supported Groups_ TLS extension --> Copy --> As a hex stream, remove any leading GREASE ciphers (?a?a) and supply it to `~/utils/hexstream2curves.sh`. Copy the last line into _curves_.
- Figure out _protos_ and _tlsvers_ by looking at the _supported_versions_ TLS extension (43=0x002b). May work only with recent clients. Be careful as some do not list all TLS versions here (OpenSSL 1.1.1 listed only TLS 1.2/1.3).
- Adjust _lowest_protocol_ and _highest_protocol_ accordingly (0301=TLS 1.0, 0302=TLS 1.1, 0303=TLS 1.2, 0304=TLS 1.3)
- Review TLS extension 13 (=0x000d) "signature*algorithm" whether any SHA1 signature algorithm is listed. If not \_requiresSha2* is true.
- Leave _maxDhBits_/_minDhBits_ and _minRsaBits_/_maxRsaBit_ at -1, unless you know for sure what the client can handle.
- Retrieve _alpn_ by looking at the _application_layer_protocol_negotiation_ TLS extension 16 (=0x0010).
- When using wireshark, copy also the ja3 and ja4 values accordingly (copy --> value), see e.g. like _java_80442_. This could be used in the future.
- Figure out the _services_ by applying a good piece of human logic. Or have a look at a different version of the client. Any (modern) browser is probably "HTTP", OpenSSL or Java "ANY" whereas mail clients as Thunderbird support a variety of protocols.
- When you're done copy your inserted section from `client-simulation.wiresharked.txt` into `client-simulation.txt`.
- Before submitting a PR: test it yourself! You can also watch it again via wireshark.
