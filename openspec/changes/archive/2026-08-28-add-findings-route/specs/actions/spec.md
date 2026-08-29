## REMOVED Requirements

### Requirement: Coordinators can create corrective actions from findings in the actions workspace

**Reason**: The creation path moves to the findings capability, where a finding is read
next to the question that opened it and the corrective action its template prescribed. The
corrective actions workspace is now dedicated to a single resource: the commitments that
already exist.

**Migration**: The equivalent behaviour is specified in the `findings` capability under
"Coordinators open a corrective action from the finding that justifies it". No API,
contract or database change accompanies the move; `POST /findings/:id/actions` is unchanged.

### Requirement: Creating an action from the workspace requires a complete future commitment

**Reason**: Same move. The submission rules travel with the creation control to the
findings capability.

**Migration**: Specified in the `findings` capability under "A corrective action opened
from a finding is a complete future commitment".
