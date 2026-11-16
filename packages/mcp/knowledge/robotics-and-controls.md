---
title: Robotics and controls
summary: Arm kinematics and joint torques, differential drive, sensors, PID tuning, and robot safety features.
---
# Robotics and controls

## Arms: reach and torque
- Degrees of freedom: 6 is general positioning in 3D; 3–4 DOF is enough for pick-and-place; each joint
  adds mass, backlash and cost.
- Planar 2-link arm (link lengths L₁, L₂; joint angles θ₁, θ₂): x = L₁ cos θ₁ + L₂ cos(θ₁ + θ₂),
  y = L₁ sin θ₁ + L₂ sin(θ₁ + θ₂). Reach = L₁ + L₂ fully extended.
- **Joint torque** is the worst case when the arm is horizontal: T = Σ (m g d), summing each mass times
  its horizontal distance from the joint (link masses at their centres, motors, and payload at the tip).
  Example: payload 0.5 kg at 300 mm + link 0.4 kg at 150 mm → T = 9.81 × (0.5×0.3 + 0.4×0.15) ≈ 2.06 N·m
  at the shoulder; add a 2× margin, plus acceleration.
- Put heavy motors near the base (counterweights or belts to move distal joints) to keep inertia low.
- Backlash and compliance cause position error that grows with arm length; use rigid links, preloaded or
  low-backlash gearing, and stiff bearings.

## Mobile robots
- Differential drive: v = (v_R + v_L)/2, ω = (v_R − v_L)/track_width. Drive wheel torque as in
  `motors-power-and-electronics`.
- Stability: keep the CoG low and between the wheels; check tipping on slopes with θ ≈ atan((b/2)/h).
- Wheels: bigger wheels roll over obstacles; softer tyres grip; casters add friction and wobble.
- Odometry drifts; add IMU, encoders, or beacons for navigation.

## Sensors and actuators
Encoders (position/speed), limit switches (end stops and homing), current sensing (stall detection), IMU
(orientation), ToF/ultrasonic (distance), cameras (vision). Place limit switches at both ends and wire them
independent of software when safety matters.

## Control basics
- **PID:** u = Kp e + Ki ∫e dt + Kd de/dt. Start with Kp only until it responds with slight overshoot, add Kd
  to damp it, add a little Ki to remove steady-state error (watch integral windup: clamp it).
- Sample fast enough (at least 10× the closed-loop bandwidth). Filter noisy derivatives.
- Trapezoidal or S-curve motion profiles prevent jerk and missed steps.
- Cascade loops for motors: current (fast) inside velocity inside position (slow).
- Test with the mechanism unloaded and slow first; always include a stop.

## Safety in robots
Add an emergency stop that removes motor power in hardware, software limits on travel, torque and speed limits
that cannot cause injury, covers over pinch points, and warnings. Moving machinery with human contact needs formal
risk assessment; do not rely on a model alone.
