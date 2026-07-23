use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
#[serde(rename_all = "lowercase")]
pub enum TouchAction {
    Down = 0,
    Up = 1,
    Move = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
#[serde(rename_all = "lowercase")]
pub enum KeyAction {
    Down = 0,
    Up = 1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ControlMessage {
    InjectTouch {
        action: TouchAction,
        pointer_id: i64,
        x: u32,
        y: u32,
        width: u16,
        height: u16,
        pressure: u16,
        buttons: u32,
    },
    InjectKeycode {
        action: KeyAction,
        keycode: u32,
        repeat: u32,
        metastate: u32,
    },
    InjectScroll {
        x: u32,
        y: u32,
        width: u16,
        height: u16,
        h: i32,
        v: i32,
        buttons: u32,
    },
}

pub fn serialize_control_message(msg: &ControlMessage) -> Vec<u8> {
    match msg {
        ControlMessage::InjectTouch {
            action,
            pointer_id,
            x,
            y,
            width,
            height,
            pressure,
            buttons,
        } => {
            let mut buf = Vec::with_capacity(28);
            buf.push(2); // Type 2 = INJECT_TOUCH_EVENT
            buf.push(*action as u8);
            buf.extend_from_slice(&pointer_id.to_be_bytes());
            buf.extend_from_slice(&x.to_be_bytes());
            buf.extend_from_slice(&y.to_be_bytes());
            buf.extend_from_slice(&width.to_be_bytes());
            buf.extend_from_slice(&height.to_be_bytes());
            buf.extend_from_slice(&pressure.to_be_bytes());
            buf.extend_from_slice(&buttons.to_be_bytes());
            buf
        }
        ControlMessage::InjectKeycode {
            action,
            keycode,
            repeat,
            metastate,
        } => {
            let mut buf = Vec::with_capacity(14);
            buf.push(0); // Type 0 = INJECT_KEYCODE_EVENT
            buf.push(*action as u8);
            buf.extend_from_slice(&keycode.to_be_bytes());
            buf.extend_from_slice(&repeat.to_be_bytes());
            buf.extend_from_slice(&metastate.to_be_bytes());
            buf
        }
        ControlMessage::InjectScroll {
            x,
            y,
            width,
            height,
            h,
            v,
            buttons,
        } => {
            let mut buf = Vec::with_capacity(25);
            buf.push(3); // Type 3 = INJECT_SCROLL_EVENT
            buf.extend_from_slice(&x.to_be_bytes());
            buf.extend_from_slice(&y.to_be_bytes());
            buf.extend_from_slice(&width.to_be_bytes());
            buf.extend_from_slice(&height.to_be_bytes());
            buf.extend_from_slice(&h.to_be_bytes());
            buf.extend_from_slice(&v.to_be_bytes());
            buf.extend_from_slice(&buttons.to_be_bytes());
            buf
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_inject_touch_down() {
        let msg = ControlMessage::InjectTouch {
            action: TouchAction::Down,
            pointer_id: -1,
            x: 540,
            y: 960,
            width: 1080,
            height: 1920,
            pressure: 0xFFFF,
            buttons: 1,
        };
        let bytes = serialize_control_message(&msg);
        assert_eq!(bytes.len(), 28);
        assert_eq!(bytes[0], 2); // Type 2 = INJECT_TOUCH_EVENT
        assert_eq!(bytes[1], 0); // Action 0 = Down
        assert_eq!(&bytes[2..10], &(-1i64).to_be_bytes());
        assert_eq!(&bytes[10..14], &540u32.to_be_bytes());
        assert_eq!(&bytes[14..18], &960u32.to_be_bytes());
        assert_eq!(&bytes[18..20], &1080u16.to_be_bytes());
        assert_eq!(&bytes[20..22], &1920u16.to_be_bytes());
        assert_eq!(&bytes[22..24], &0xFFFFu16.to_be_bytes());
        assert_eq!(&bytes[24..28], &1u32.to_be_bytes());
    }

    #[test]
    fn test_serialize_inject_keycode() {
        let msg = ControlMessage::InjectKeycode {
            action: KeyAction::Down,
            keycode: 4, // AKEYCODE_BACK
            repeat: 0,
            metastate: 0,
        };
        let bytes = serialize_control_message(&msg);
        assert_eq!(bytes.len(), 14);
        assert_eq!(bytes[0], 0); // Type 0 = INJECT_KEYCODE_EVENT
        assert_eq!(bytes[1], 0); // Action 0 = Down
        assert_eq!(&bytes[2..6], &4u32.to_be_bytes());
        assert_eq!(&bytes[6..10], &0u32.to_be_bytes());
        assert_eq!(&bytes[10..14], &0u32.to_be_bytes());
    }

    #[test]
    fn test_serialize_inject_scroll() {
        let msg = ControlMessage::InjectScroll {
            x: 100,
            y: 200,
            width: 1080,
            height: 1920,
            h: 0,
            v: -5,
            buttons: 0,
        };
        let bytes = serialize_control_message(&msg);
        assert_eq!(bytes.len(), 25);
        assert_eq!(bytes[0], 3); // Type 3 = INJECT_SCROLL_EVENT
        assert_eq!(&bytes[1..5], &100u32.to_be_bytes());
        assert_eq!(&bytes[5..9], &200u32.to_be_bytes());
        assert_eq!(&bytes[9..11], &1080u16.to_be_bytes());
        assert_eq!(&bytes[11..13], &1920u16.to_be_bytes());
        assert_eq!(&bytes[13..17], &0i32.to_be_bytes());
        assert_eq!(&bytes[17..21], &(-5i32).to_be_bytes());
        assert_eq!(&bytes[21..25], &0u32.to_be_bytes());
    }
}
