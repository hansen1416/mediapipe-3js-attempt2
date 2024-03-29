import * as THREE from "three";
import { BlazePoseKeypointsValues } from "../utils/ropes";
import ThreeScene, { SceneProperties } from "./ThreeScene";
import RapierWorld from "./RapierWorld";
import Player from "./Player";
import PlayerMain from "./PlayerMain";
import Pitcher from "./Pitcher";

let instance;

export default class PlayerController {
	/**
	 * @type {Player[]}
	 */
	players = [];
	/**
	 * @type {{[key: string]: number}}
	 */
	players_mapping = {};

	/**
	 * @type {PlayerMain}
	 */
	main_player;

	/**
	 * @type {Pitcher}
	 */
	pitcher;

	// [0, 1] how sensitive the camera respond to player's rotation, higher is more sensitive
	camera_sensitivity = 0.1;

	/**
	 * @type {THREE.Mesh}
	 */
	left_projectile;
	/**
	 * @type {THREE.Mesh}
	 */
	right_projectile;

	/**
	 * @type {THREE.Mesh[]}
	 */
	projectile_meshes = [];

	/**
	 * @type {import("./RapierWorld").RigidBody[]}
	 */
	projectile_rigid = [];

	/**
	 * @type {Array}
	 */
	animation_data;
	/**
	 * @type {number}
	 */
	animation_data_idx = 0;

	/**
	 *
	 * @param {ThreeScene} renderer
	 * @param {RapierWorld} physics
	 */
	constructor(renderer, physics) {
		if (instance) {
			return instance;
		} else {
			instance = this;
		}

		this.renderer = renderer;
		this.physics = physics;
	}

	destructor() {
		// todo clear all players, from this class, threejs scene, cannon world

		console.log("PlayerController destructor");
	}

	/**
	 *
	 * @param {boolean} left
	 * @returns {THREE.Mesh}
	 */
	getProjectile(left = false) {
		return left ? this.left_projectile : this.right_projectile;
	}
	/**
	 *
	 * @param {THREE.Mesh} mesh
	 * @param {boolean} left
	 */
	setProjectile(mesh, left = false) {
		if (left) {
			this.left_projectile = mesh;
		} else {
			this.right_projectile = mesh;
		}
	}

	/**
	 *
	 * @param {Array[]} data
	 */
	setAnimationData(data) {
		this.animation_data = data.slice(40, 74);
	}

	/**
	 *
	 * @param {THREE.Mesh} model
	 * @param {{x: number, y: number, z: number}} position
	 * @param {{x: number, y: number, z: number}} rotation
	 * @param {boolean} is_main
	 */
	addPlayer(
		model,
		position = { x: 0, y: 0, z: 0 },
		rotation = { x: 0, y: 0, z: 0 },
		is_main = false
	) {
		let player;

		if (is_main) {
			player = new PlayerMain(model, position, rotation);
			this.main_player = player;

			// prepare the controller and collider
			this.physics.createCharacter();

			this.pitcher = new Pitcher(player);

			this.pitcher.subscribe(this);
		} else {
			player = new Player(model, position, rotation);

			this.players.push(player);
			this.players_mapping[player.uuid] = this.players.length - 1;
		}

		this.renderer.scene.add(player.mesh);
	}

	/**
	 *
	 * @param {{x:number, z:number}} xz_pos
	 */
	initPLayerPos(xz_pos) {
		// find raycast terrain height
		const init_pos = this.physics.raycastingTerrain(xz_pos);

		if (!init_pos) {
			this.main_player.mesh.position.x = xz_pos.x;
			this.main_player.mesh.position.z = xz_pos.z;
		} else {
			this.main_player.mesh.position.x = init_pos.x;
			this.main_player.mesh.position.y = init_pos.y;
			this.main_player.mesh.position.z = init_pos.z;
		}

		let camera_pos = this.physics.raycastingTerrain({
			x: this.main_player.mesh.position.x,
			z: this.main_player.mesh.position.z - SceneProperties.camera_far_z,
		});

		if (!camera_pos) {
			camera_pos = {
				x: this.main_player.mesh.position.x,
				y: this.main_player.mesh.position.y,
				z:
					this.main_player.mesh.position.z -
					SceneProperties.camera_far_z,
			};
		}

		camera_pos.y += SceneProperties.camera_height;

		// put camera behind player
		this.renderer.camera.position.copy(
			new THREE.Vector3(camera_pos.x, camera_pos.y, camera_pos.z)
		);

		this.renderer.camera.lookAt(this.main_player.mesh.position);

		// set control center
		this.renderer.controls.target.set(
			this.main_player.mesh.position.x,
			this.main_player.mesh.position.y,
			this.main_player.mesh.position.z
		);

		this.renderer.controls.saveState();
	}

	/**
	 *
	 * @param {string} uuid
	 */
	removePlayer(uuid) {
		const player = this.players[this.players_mapping[uuid]];

		this.renderer.removePlayerObj(player.mesh);

		// if (player.body) {
		// 	this.physics.removePlayerBody(player.body);
		// }

		// how to effctively remove the player from array
		const idx = this.players_mapping[uuid];

		// remove Player instance from `this.players`, also update
		if (idx >= 0) {
			this.players.splice(idx, 1);

			for (let i = idx; i < this.players.length; i++) {
				this.players_mapping[this.players[i].uuid] = i;
			}
		}

		delete this.players_mapping[uuid];
	}

	/**
	 * call this in each animaiton frame
	 * it controls the other players movement
	 */
	onFrameUpdate() {
		// todo, update other players rigid and mesh
		for (let i = 0; i < this.players.length; i++) {
			if (this.players[i].speed) {
				this.players[i].mesh.position.add(this.players[i].speed);
			}
		}

		for (let i in this.projectile_rigid) {
			const t = this.projectile_rigid[i].translation();
			this.projectile_meshes[i].position.set(t.x, t.y, t.z);

			const r = this.projectile_rigid[i].rotation();
			this.projectile_meshes[i].setRotationFromQuaternion(
				new THREE.Quaternion(r.x, r.y, r.z, r.w)
			);
		}
	}

	/**
	 *	this function is called in the `onPoseCallback`,
	 *  so it's a bit (a few ms) slower than `requestAnimationFrame`
	 *
	 * @param {{x:number, y:number, z:number}[]} pose3D
	 * @param {{x:number, y:number, z:number}[]} pose2D
	 * @param {boolean} lower_body
	 * @returns
	 */
	onPoseCallback(pose3D, pose2D, lower_body = false) {
		if (!this.main_player) {
			return;
		}

		const width_ratio = 30;
		const height_ratio = (width_ratio * 480) / 640;

		// multiply x,y by width/height factor
		for (let i = 0; i < pose3D.length; i++) {
			pose3D[i].x *= width_ratio;
			pose3D[i].y *= -height_ratio;
			pose3D[i].z *= -width_ratio;
		}

		// the shoulder pose rotation control the rotation of mesh
		const shoulder_vector_pose = new THREE.Vector3(
			pose3D[BlazePoseKeypointsValues["RIGHT_SHOULDER"]].x -
				pose3D[BlazePoseKeypointsValues["LEFT_SHOULDER"]].x,
			pose3D[BlazePoseKeypointsValues["RIGHT_SHOULDER"]].y -
				pose3D[BlazePoseKeypointsValues["LEFT_SHOULDER"]].y,
			pose3D[BlazePoseKeypointsValues["RIGHT_SHOULDER"]].z -
				pose3D[BlazePoseKeypointsValues["LEFT_SHOULDER"]].z
		).normalize();

		// this must happend before apply pose to bones,
		// cause we need to apply rotation to the captured pose position
		// rotate main player's mesh and rigid
		this.rotateMainPlayer(shoulder_vector_pose);

		// this.main_player.pose2totation.applyPose2Bone(pose3Dvec, lower_body);
		const shoulder_vector_mesh = this.main_player.applyPose2Bone(
			pose3D,
			lower_body
		);

		// calculate target translation by xz_direction and raycasting
		// move main player's mesh and rigid to the target translation
		// update player's speed
		// the shoulder mesh rotation control the camera direction and speed direction
		this.moveMainPlayer(shoulder_vector_mesh);

		// captured pose only control upper body
		// we need to apply animation to lower body of player depends on player's `speed`
		this.applyLowerBodyAnimation2MainPlayer();

		// update hands track, for pitching
		this.pitcher.onPoseCallback(this.main_player.speed);
	}

	/**
	 *
	 * @param {THREE.Vector3} shoulder_vector right_shoulder_position - left_shoulder_position
	 */
	rotateMainPlayer(shoulder_vector) {
		const quaternion = this.main_player.rotate(shoulder_vector);

		this.physics.rotateCharacter(quaternion);
	}

	/**
	 *
	 * @param {THREE.Vector3} shoulder_vector right_shoulder_position - left_shoulder_position
	 */
	moveMainPlayer(shoulder_vector) {
		const speed_direction = new THREE.Vector2(
			shoulder_vector.z,
			-shoulder_vector.x
		);

		// todo, calculate speed direction, and control it by speed_scalar

		// scale the speed by x,z, this isn't accurate due to y=0
		// the correct approach is to gradually reduce the length of speed vector,
		// until it's perfectly match the terrain surface
		// but if the step is small enough, the error maybe neglectable
		speed_direction
			.normalize()
			.multiplyScalar(this.main_player.speed_scalar);

		// find terrain height
		let target_translation = this.physics.raycastingTerrain({
			x: speed_direction.x + this.main_player.mesh.position.x,
			z: speed_direction.y + this.main_player.mesh.position.z,
		});

		if (!target_translation) {
			// in case raycasting not find a position on terrain
			target_translation = {
				x: speed_direction.x + this.main_player.mesh.position.x,
				y: this.main_player.mesh.position.y,
				z: speed_direction.y + this.main_player.mesh.position.z,
			};
		}

		this.main_player.updateSpeed({
			x: target_translation.x - this.main_player.mesh.position.x,
			y: target_translation.y - this.main_player.mesh.position.y,
			z: target_translation.z - this.main_player.mesh.position.z,
		});

		this.physics.moveCharacter(target_translation);
		this.main_player.move(target_translation);

		/**
		given two shoulder positions, calculate the middle orthogonal vector

		const direction = new THREE.Vector2().subVectors(point2, point1).normalize();
		const orthogonal1 = new THREE.Vector2(-direction.y, direction.x).normalize();
		const orthogonal2 = new THREE.Vector2(direction.y, -direction.x).normalize();

		note that for main player, the +x is to the left hand side, +z is toward the screen.
		so the vector towards the player's back is (-z, y, x)

		and multiply a scalar to the vector which towards back,
		and add to the players position
		we should have the camera position, which is always at the back of player

		slerp by `camera_sensitivity` each step, so the camera is smooth

		*/

		const camera_direction = new THREE.Vector2(
			-shoulder_vector.z,
			shoulder_vector.x
		)
			.normalize()
			.multiplyScalar(SceneProperties.camera_far_z);

		// the height of camera is constant
		// its direction is controlled by mesh shoulder
		let camera_pos = this.physics.raycastingTerrain({
			x: this.main_player.mesh.position.x + camera_direction.x,
			z: this.main_player.mesh.position.z + camera_direction.y,
		});

		if (!camera_pos) {
			camera_pos = {
				x: this.main_player.mesh.position.x,
				y: this.main_player.mesh.position.y,
				z:
					this.main_player.mesh.position.z -
					SceneProperties.camera_far_z,
			};
		}

		camera_pos.y += SceneProperties.camera_height;

		this.renderer.camera.position.lerp(
			new THREE.Vector3(camera_pos.x, camera_pos.y, camera_pos.z),
			this.camera_sensitivity
		);
		this.renderer.camera.lookAt(this.main_player.mesh.position);
	}

	/**
	 * apply animation data to lower body, like walk, run, etc
	 */
	applyLowerBodyAnimation2MainPlayer() {
		if (!this.animation_data) {
			return;
		}

		// console.log(this.animation_data);

		//
		this.main_player.applyAnimation2Bone(
			this.animation_data[this.animation_data_idx]
		);

		this.animation_data_idx++;

		if (this.animation_data_idx >= this.animation_data.length) {
			this.animation_data_idx = 0;
		}
	}

	/**
	 *
	 * @param {THREE.Vector3} position
	 * @param {boolean} left
	 */
	addProjectileToHand(position, left = false) {
		// console.log(position, this);

		const mesh = this.renderer.createProjectile();

		mesh.position.copy(position);

		this.setProjectile(mesh, left);
	}

	/**
	 *
	 * @param {THREE.Vector3} position
	 * @param {boolean} left
	 */
	updateProjectilePos(position, left = false) {
		this.getProjectile(left).position.copy(position);
	}

	/**
	 * 	The value of linearDamping can be set to any non-negative number, 
		with higher values resulting in faster loss of velocity. 
		A value of 0 means there is no damping effect, 
		and the body will continue moving at a constant velocity forever.

	 * @param {THREE.Vector3} velocity
	 * @param {boolean} left
	 */
	shoot(velocity, left = false) {
		const mesh = this.getProjectile(left);

		const body = this.physics.createProjectile(mesh.position, velocity);

		this.projectile_meshes.push(mesh);
		this.projectile_rigid.push(body);
	}
}
