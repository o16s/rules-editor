# The rule files of the three services

Copies of `examples/rules.xml` from iolinkmaster2mqtt, modbus2mqtt and
tsend2mqtt, as they were when the module replaced their engines. `service_test.go`
loads each one against a catalog built from the fields the service documents,
and replays a short value sequence.

They are copies, not sources. When a service changes its example, copy it here
again and let the test say what changed.
