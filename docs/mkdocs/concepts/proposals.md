# Proposals & M-of-N

Every governance decision in chaincoord goes through a **proposal**. A proposal is a signed, time-limited action that executes automatically when M coordinators sign it.

---

## How proposals work

1. Any committee member raises a proposal (`POST /launch/:id/proposal`). The proposer's signature is recorded implicitly — raising a proposal counts as a SIGN.
2. Other committee members review the proposal and submit a SIGN or VETO decision (`POST /launch/:id/proposal/:pid/sign`).
3. The proposal resolves when one of three things happens:
   - **Quorum reached:** M SIGN decisions collected → proposal executes immediately
   - **Vetoed:** any member submits VETO → proposal moves to `VETOED`, no execution
   - **Expired:** TTL elapses before quorum → proposal moves to `EXPIRED`

If M=1 (a 1-of-1 or 1-of-N committee), the proposal executes the moment it is raised.

---

## Proposal states

| State | Description |
|---|---|
| `PENDING_SIGNATURES` | Waiting for more signatures |
| `EXECUTED` | Quorum reached; action applied |
| `VETOED` | A member vetoed; no execution |
| `EXPIRED` | TTL elapsed before quorum |

---

## Action types

### Validator management

| Action | Effect | Required status |
|---|---|---|
| `APPROVE_VALIDATOR` | Approves a pending join request; adds validator to the approved set | `WINDOW_OPEN` |
| `REJECT_VALIDATOR` | Rejects a pending join request with a reason | `WINDOW_OPEN` |
| `REMOVE_APPROVED_VALIDATOR` | Revokes an already-approved validator | `WINDOW_OPEN` or `WINDOW_CLOSED` |

### Lifecycle transitions

| Action | Transition | Required status |
|---|---|---|
| `PUBLISH_CHAIN_RECORD` | `DRAFT` → `PUBLISHED` | `DRAFT` |
| `CLOSE_APPLICATION_WINDOW` | `WINDOW_OPEN` → `WINDOW_CLOSED` | `WINDOW_OPEN` |
| `PUBLISH_GENESIS` | `WINDOW_CLOSED` → `GENESIS_READY` | `WINDOW_CLOSED` |
| `REVISE_GENESIS` | `GENESIS_READY` → `WINDOW_CLOSED` | `GENESIS_READY` |

### Genesis metadata

| Action | Effect | Required status |
|---|---|---|
| `UPDATE_GENESIS_TIME` | Updates the `genesis_time` field | Any pre-`LAUNCHED` |
| `ADD_GENESIS_ACCOUNT` | Adds a pre-funded account to the genesis | Any pre-`WINDOW_CLOSED` |
| `REMOVE_GENESIS_ACCOUNT` | Removes a pre-funded account | Any pre-`WINDOW_CLOSED` |
| `MODIFY_GENESIS_ACCOUNT` | Changes amount or vesting schedule | Any pre-`WINDOW_CLOSED` |

### Committee management

| Action | Effect |
|---|---|
| `REPLACE_COMMITTEE_MEMBER` | Swaps one member for another; if the replaced member was the lead, the replacement becomes the lead |
| `EXPAND_COMMITTEE` | Adds a new member; optionally sets a new threshold M |
| `SHRINK_COMMITTEE` | Removes a member; M must remain < N (liveness guard) |

---

## Signing a proposal

Each signature is a secp256k1 signature over a canonical JSON payload that includes:

- The coordinator's address
- The decision (`SIGN` or `VETO`)
- A nonce (replay protection)
- A timestamp

The server verifies the signature against the member's declared public key before recording it.

---

## Liveness guard

The committee size N and threshold M must always satisfy `M < N`. This is enforced on `EXPAND_COMMITTEE` and `SHRINK_COMMITTEE` proposals. The constraint ensures the committee can still reach quorum even if one member is permanently offline — a 3-of-3 committee, for example, would be permanently deadlocked if any single member lost their key.

The only exception is a 1-of-1 committee, where M = N = 1 is permitted (there is no other member to lose).

---

## BFT voting power warning

When a validator is approved, the server recalculates the share of total committed self-delegation held by each operator. If any single entity reaches or exceeds 1/3 of the total, a warning is included in the approval response. The same check is enforced as a hard precondition when closing the application window — a launch cannot move to `WINDOW_CLOSED` if any entity holds ≥ 1/3 of voting power.

This is a structural check only. It does not account for stake that will be delegated after genesis.